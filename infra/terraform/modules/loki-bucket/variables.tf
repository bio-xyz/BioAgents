variable "bucket_name" {
  description = "S3 bucket name (must be globally unique). E.g. bioagents-loki-staging."
  type        = string
}

variable "retention_days" {
  description = "Days before objects are deleted from S3. Pair with Loki's max_query_lookback (90d): hot in STANDARD, cold in GLACIER_IR, then expire."
  type        = number
}

variable "glacier_transition_days" {
  description = "Days before chunks transition from STANDARD to GLACIER_IR. Should match Loki's max_query_lookback — older chunks aren't queryable through Grafana so retrieval cost doesn't apply for normal ops."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Tags applied to the bucket."
  type        = map(string)
  default     = {}
}
