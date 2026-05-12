variable "role_name" {
  description = "IAM role name (e.g. bioagents-deployer-staging)."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "ARN of the account-wide GitHub Actions OIDC provider."
  type        = string
}

variable "github_org" {
  description = "GitHub org owning the repo (e.g. bio-xyz)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name (e.g. BioAgents)."
  type        = string
}

variable "github_branch" {
  description = "Branch name the role can be assumed from (e.g. dev, main). The sub claim is scoped to refs/heads/<this>."
  type        = string
}

variable "cluster_name" {
  description = "EKS cluster name the role needs DescribeCluster on."
  type        = string
}

variable "cluster_arn" {
  description = "EKS cluster ARN. Used to scope the access entry."
  type        = string
}

variable "tags" {
  description = "Tags applied to the IAM role."
  type        = map(string)
  default     = {}
}
