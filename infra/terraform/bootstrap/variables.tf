variable "region" {
  description = "AWS region for the state backend resources."
  type        = string
  default     = "us-west-2"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform state."
  type        = string
  default     = "bioagents-tf-state"
}

variable "lock_table_name" {
  description = "DynamoDB table name for Terraform state locking."
  type        = string
  default     = "bioagents-tf-state-lock"
}
