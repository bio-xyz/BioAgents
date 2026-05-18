variable "loki_irsa_role_arn" {
  description = "ARN of the IAM role the Loki SA assumes via IRSA. Injected as a ServiceAccount annotation."
  type        = string
}

variable "loki_bucket_name" {
  description = "S3 bucket Loki writes chunks/ruler/admin to."
  type        = string
}

variable "aws_region" {
  description = "AWS region the Loki S3 bucket lives in."
  type        = string
}

variable "loki_chart_version" {
  description = "grafana/loki Helm chart version."
  type        = string
  default     = "6.16.0"
}

variable "alloy_chart_version" {
  description = "grafana/alloy Helm chart version."
  type        = string
  default     = "0.10.1"
}

variable "loki_base_values_path" {
  description = "Path to the base Loki Helm values yaml (in the app repo)."
  type        = string
}

variable "alloy_base_values_path" {
  description = "Path to the base Alloy Helm values yaml."
  type        = string
}
