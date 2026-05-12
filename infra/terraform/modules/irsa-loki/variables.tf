variable "role_name" {
  description = "IAM role name (e.g. bioagents-loki-staging)."
  type        = string
}

variable "cluster_oidc_provider_arn" {
  description = "ARN of the EKS cluster's OIDC provider."
  type        = string
}

variable "cluster_oidc_provider_url" {
  description = "EKS cluster OIDC provider URL (without https://)."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace where the Loki SA lives."
  type        = string
  default     = "logging"
}

variable "service_account_name" {
  description = "ServiceAccount name annotated with this role's ARN."
  type        = string
  default     = "loki"
}

variable "bucket_arn" {
  description = "S3 bucket ARN this role can read/write."
  type        = string
}

variable "tags" {
  description = "Tags applied to the IAM role."
  type        = map(string)
  default     = {}
}
