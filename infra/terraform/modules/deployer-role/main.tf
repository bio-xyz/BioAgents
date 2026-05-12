# IAM role assumed by GitHub Actions to deploy this env. Trust is scoped to
# the specific repo AND the specific branch — this is the policy that
# enforces "prod role only assumable from refs/heads/main".

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      # Exact match — no wildcards. Tags, pull_request, and other branches
      # are rejected.
      values = ["repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "deployer" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = var.tags
}

# Minimum AWS-side permissions: describe the cluster (so update-kubeconfig
# works). All actual cluster RBAC comes from the EKS access entry below.
data "aws_iam_policy_document" "describe_cluster" {
  statement {
    effect = "Allow"
    actions = [
      "eks:DescribeCluster",
      "eks:ListClusters",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "describe_cluster" {
  name   = "${var.role_name}-describe-cluster"
  role   = aws_iam_role.deployer.id
  policy = data.aws_iam_policy_document.describe_cluster.json
}

# EKS access entry: maps the IAM role to a Kubernetes admin identity.
# This replaces the legacy aws-auth ConfigMap mapping.
resource "aws_eks_access_entry" "deployer" {
  cluster_name  = var.cluster_name
  principal_arn = aws_iam_role.deployer.arn
  type          = "STANDARD"
}

resource "aws_eks_access_policy_association" "deployer" {
  cluster_name  = var.cluster_name
  principal_arn = aws_iam_role.deployer.arn

  # AmazonEKSClusterAdminPolicy is the broadest. Tighten later by switching
  # to AmazonEKSAdminPolicy + a namespace scope if cluster-admin is too much.
  policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}
