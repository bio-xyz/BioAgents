variable "bucket_name" {
  description = "S3 bucket name (must be globally unique). E.g. bioagents-loki-staging."
  type        = string
}

variable "retention_days" {
  description = "Days before chunks expire. 90 for staging, 365+ for prod."
  type        = number
}

variable "tags" {
  description = "Tags applied to the bucket."
  type        = map(string)
  default     = {}
}
