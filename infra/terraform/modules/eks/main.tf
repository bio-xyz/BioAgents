# EKS cluster + one managed node group dedicated to workers.
#
# Access entries (not aws-auth) — the deployer role is wired in by the env
# composition via aws_eks_access_entry / _policy_association so this module
# stays neutral about who can administer the cluster.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  # API endpoint exposure.
  endpoint_public_access       = var.endpoint_public_access
  endpoint_public_access_cidrs = var.endpoint_public_access_cidrs
  endpoint_private_access      = true

  # Authentication: EKS access entries (replaces aws-auth ConfigMap).
  authentication_mode = "API"

  # v21 default is false. Grant the Terraform-running principal admin so the
  # operator can `kubectl` against the cluster after bring-up and so the
  # module itself can manage cluster-scoped resources (addons, etc.).
  enable_cluster_creator_admin_permissions = true

  # KMS-encrypt cluster secrets.
  encryption_config = {
    resources = ["secrets"]
  }

  # AWS-managed addons. Keep at module defaults; bumping is a TF apply.
  # aws-ebs-csi-driver lives outside this block — it needs an IRSA role to
  # call EC2 API, and wiring IRSA from inside this module would create a
  # circular dependency with the OIDC provider it itself creates. The cluster
  # composition installs the addon separately.
  addons = {
    # vpc-cni + kube-proxy MUST be installed before the node group is checked
    # for health — without them, kubelet stays NotReady, the managed node
    # group reports "Unhealthy nodes" and create fails. CoreDNS needs nodes
    # to schedule on, so it goes after compute.
    vpc-cni = {
      most_recent    = true
      before_compute = true
    }
    kube-proxy = {
      most_recent    = true
      before_compute = true
    }
    coredns = {
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
