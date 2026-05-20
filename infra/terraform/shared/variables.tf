variable "region" {
  description = "AWS region for the shared resources."
  type        = string
  default     = "us-west-2"
}

variable "github_org" {
  description = "GitHub organisation that owns the repos allowed to assume deployer roles."
  type        = string
  default     = "bio-xyz"
}
