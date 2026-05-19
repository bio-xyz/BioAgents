locals {
  cluster_name   = "bioagents"
  loki_role      = "bioagents-loki"
  loki_bucket    = "bioagents-loki"
  repo_root      = "${path.root}/../../.."
  loki_addon_dir = "${local.repo_root}/k8s/cluster-addons/loki"

  worker_namespaces = {
    staging = "bioagents-staging"
    prod    = "bioagents-prod"
  }

  tags = {
    Project = "bioagents"
    Managed = "terraform"
  }
}

# Account-wide shared state (GitHub OIDC provider).
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "bioagents-tf-state"
    key    = "shared/terraform.tfstate"
    region = "us-west-2"
  }
}

data "aws_caller_identity" "current" {}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

# VPC
module "vpc" {
  source = "../modules/vpc"

  name       = local.cluster_name
  cidr       = var.vpc_cidr
  az_count   = 3
  single_nat = true
  tags       = local.tags
}

# EKS cluster + workers-ondemand node group (shared by staging+prod namespaces)
module "eks" {
  source = "../modules/eks"

  cluster_name       = local.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids

  node_instance_types = var.node_instance_types
  node_min_size       = var.node_min_size
  node_desired_size   = var.node_desired_size
  node_max_size       = var.node_max_size

  tags = local.tags
}

# Per-env GitHub Actions deployer roles. Each role is scoped to:
#   - one git branch (sub claim)        — enforced by the trust policy
#   - one Kubernetes namespace          — enforced by the EKS access policy
# So a dev-branch deploy can never touch the bioagents-prod namespace and vice versa.
module "deployer_role_staging" {
  source = "../modules/deployer-role"

  role_name                = "bioagents-deployer-staging"
  github_oidc_provider_arn = data.terraform_remote_state.shared.outputs.github_oidc_provider_arn
  github_org               = data.terraform_remote_state.shared.outputs.github_org
  github_repo              = var.github_repo
  github_branch            = var.staging_branch
  cluster_name             = module.eks.cluster_name
  cluster_arn              = "arn:aws:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${module.eks.cluster_name}"
  target_namespace         = local.worker_namespaces.staging
  tags                     = local.tags
}

module "deployer_role_prod" {
  source = "../modules/deployer-role"

  role_name                = "bioagents-deployer-prod"
  github_oidc_provider_arn = data.terraform_remote_state.shared.outputs.github_oidc_provider_arn
  github_org               = data.terraform_remote_state.shared.outputs.github_org
  github_repo              = var.github_repo
  github_branch            = var.prod_branch
  cluster_name             = module.eks.cluster_name
  cluster_arn              = "arn:aws:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${module.eks.cluster_name}"
  target_namespace         = local.worker_namespaces.prod
  tags                     = local.tags
}

# Loki S3 bucket — single bucket, both namespaces' logs land here under their
# own labels. S3 lifecycle: STANDARD → GLACIER_IR @ 90d → expire @ retention_days.
module "loki_bucket" {
  source = "../modules/loki-bucket"

  bucket_name             = local.loki_bucket
  retention_days          = var.loki_retention_days
  glacier_transition_days = var.loki_glacier_transition_days
  tags                    = local.tags
}

module "loki_irsa" {
  source = "../modules/irsa-loki"

  role_name                 = local.loki_role
  cluster_oidc_provider_arn = module.eks.oidc_provider_arn
  cluster_oidc_provider_url = module.eks.oidc_provider_url
  bucket_arn                = module.loki_bucket.bucket_arn
  tags                      = local.tags
}

# IRSA + addon for the EBS CSI driver. Lives here (not in modules/eks/) so the
# trust policy can reference the OIDC provider that the eks module creates —
# circular if collocated.
data "aws_iam_policy_document" "ebs_csi_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${local.cluster_name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_trust.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "aws-ebs-csi-driver"
  service_account_role_arn = aws_iam_role.ebs_csi.arn

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [
    aws_iam_role_policy_attachment.ebs_csi,
    module.eks,
  ]
}

# Helm + Kubernetes provider config — wired to the cluster module's outputs.
# Terraform resolves provider blocks lazily, so this works in the same apply
# as the cluster creation, but the first apply needs -target=module.eks to
# avoid the helm provider trying to talk to a not-yet-existing cluster.
data "aws_eks_cluster_auth" "this" {
  name = module.eks.cluster_name
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca)
  token                  = data.aws_eks_cluster_auth.this.token
}

# Worker namespaces. TF owns these (not the Kustomize overlays) so the
# namespace-scoped deployer roles don't need cluster-scope perms to create
# them. PSS Restricted is enforced; admin Loki/Alloy live in the `logging`
# namespace which doesn't enforce PSS.
resource "kubernetes_namespace" "worker" {
  for_each = local.worker_namespaces

  metadata {
    name = each.value
    labels = {
      "pod-security.kubernetes.io/enforce" = "restricted"
      "pod-security.kubernetes.io/audit"   = "restricted"
      "pod-security.kubernetes.io/warn"    = "restricted"
    }
  }

  depends_on = [module.eks]
}

# Per-namespace ResourceQuota. Owned by TF (not the deploy role) so the deploy
# actor can't raise its own ceiling. Sized from each overlay's KEDA max
# replicas × base requests + ~50% headroom.
resource "kubernetes_resource_quota" "worker" {
  for_each = local.worker_namespaces

  metadata {
    name      = "${each.value}-quota"
    namespace = kubernetes_namespace.worker[each.key].metadata[0].name
  }

  spec {
    hard = {
      "requests.cpu"    = each.key == "prod" ? var.prod_quota.cpu_requests : var.staging_quota.cpu_requests
      "requests.memory" = each.key == "prod" ? var.prod_quota.memory : var.staging_quota.memory
      "limits.cpu"      = each.key == "prod" ? var.prod_quota.cpu_limits : var.staging_quota.cpu_limits
      "pods"            = each.key == "prod" ? var.prod_quota.pods : var.staging_quota.pods
    }
  }
}

# Loki + Alloy via Helm, wired to the IRSA role and S3 bucket.
module "observability" {
  source = "../modules/observability"

  loki_irsa_role_arn = module.loki_irsa.role_arn
  loki_bucket_name   = module.loki_bucket.bucket_name
  aws_region         = var.region

  loki_base_values_path  = "${local.loki_addon_dir}/values.yaml"
  alloy_base_values_path = "${local.repo_root}/k8s/cluster-addons/alloy/values.yaml"

  depends_on = [module.eks]
}
