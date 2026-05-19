# EKS cluster + one managed node group dedicated to workers.
#
# Access entries (not aws-auth) — the deployer role is wired in by the env
# composition via aws_eks_access_entry / _policy_association so this module
# stays neutral about who can administer the cluster.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  # API endpoint exposure.
  cluster_endpoint_public_access       = var.endpoint_public_access
  cluster_endpoint_public_access_cidrs = var.endpoint_public_access_cidrs
  cluster_endpoint_private_access      = true

  # Authentication: EKS access entries (replaces aws-auth ConfigMap).
  authentication_mode = "API"

  # IRSA — required for Loki SA → S3, future worker SA → S3.
  enable_irsa = true

  # KMS-encrypt cluster secrets.
  create_kms_key = true
  cluster_encryption_config = {
    resources = ["secrets"]
  }

  # AWS-managed addons. Keep at module defaults; bumping is a TF apply.
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
    aws-ebs-csi-driver = {
      most_recent = true
    }
  }

  # Single managed node group. No taint — this cluster runs workers AND the
  # AWS-managed addons (CoreDNS, EBS CSI, kube-proxy, vpc-cni) AND in-cluster
  # observability. A `workload=worker:NoSchedule` taint would block CoreDNS /
  # EBS CSI from scheduling (they don't carry the matching toleration). The
  # label stays so future node-pool segmentation has an affinity hook.
  eks_managed_node_groups = {
    workers-ondemand = {
      instance_types = var.node_instance_types
      capacity_type  = "ON_DEMAND"

      min_size     = var.node_min_size
      desired_size = var.node_desired_size
      max_size     = var.node_max_size

      labels = {
        workload = "worker"
      }
    }
  }

  tags = var.tags
}
