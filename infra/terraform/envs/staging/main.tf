locals {
  cluster_name     = "bioagents-${var.env_name}"
  deployer_role    = "bioagents-deployer-${var.env_name}"
  worker_namespace = "bioagents-${var.env_name}"
  loki_role        = "bioagents-loki-${var.env_name}"
  loki_bucket      = "bioagents-loki-${var.env_name}"
  repo_root        = "${path.root}/../../../.."
  loki_addon_dir   = "${local.repo_root}/k8s/cluster-addons/loki"

  tags = {
    Project = "bioagents"
    Env     = var.env_name
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

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

# VPC
module "vpc" {
  source = "../../modules/vpc"

  name       = "bioagents-${var.env_name}"
  cidr       = var.vpc_cidr
  az_count   = 3
  single_nat = true
  tags       = local.tags
}

# EKS cluster + workers-ondemand node group
module "eks" {
  source = "../../modules/eks"

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

# GitHub Actions deployer role, scoped to refs/heads/<branch>.
module "deployer_role" {
  source = "../../modules/deployer-role"

  role_name                = local.deployer_role
  github_oidc_provider_arn = data.terraform_remote_state.shared.outputs.github_oidc_provider_arn
  github_org               = data.terraform_remote_state.shared.outputs.github_org
  github_repo              = var.github_repo
  github_branch            = var.github_branch
  cluster_name             = module.eks.cluster_name
  cluster_arn              = "arn:aws:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${module.eks.cluster_name}"
  target_namespace         = local.worker_namespace
  tags                     = local.tags
}

data "aws_caller_identity" "current" {}

# Loki S3 bucket
module "loki_bucket" {
  source = "../../modules/loki-bucket"

  bucket_name    = local.loki_bucket
  retention_days = var.loki_retention_days
  tags           = local.tags
}

# IRSA role for the Loki ServiceAccount
module "loki_irsa" {
  source = "../../modules/irsa-loki"

  role_name                 = local.loki_role
  cluster_oidc_provider_arn = module.eks.oidc_provider_arn
  cluster_oidc_provider_url = module.eks.oidc_provider_url
  bucket_arn                = module.loki_bucket.bucket_arn
  tags                      = local.tags
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

# Loki + Alloy via Helm, wired to the IRSA role and S3 bucket.
module "observability" {
  source = "../../modules/observability"

  loki_irsa_role_arn = module.loki_irsa.role_arn
  loki_bucket_name   = module.loki_bucket.bucket_name
  aws_region         = var.region

  loki_base_values_path  = "${local.loki_addon_dir}/values.yaml"
  loki_env_values_path   = "${local.loki_addon_dir}/values.eks-${var.env_name}.yaml"
  alloy_base_values_path = "${local.repo_root}/k8s/cluster-addons/alloy/values.yaml"

  depends_on = [module.eks]
}
