variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-west-2"
}

variable "env_name" {
  description = "Short env name."
  type        = string
  default     = "prod"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deployer role."
  type        = string
  default     = "BioAgents"
}

variable "github_branch" {
  description = "Branch the deployer role can be assumed from."
  type        = string
  default     = "main"
}

variable "vpc_cidr" {
  description = "Primary VPC CIDR (non-overlapping with staging)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "kubernetes_version" {
  description = "Kubernetes minor version for the EKS cluster."
  type        = string
  default     = "1.31"
}

variable "node_instance_types" {
  description = "Instance types for workers-ondemand."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "node_min_size" {
  description = "Min nodes."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Desired nodes."
  type        = number
  default     = 3
}

variable "node_max_size" {
  description = "Max nodes."
  type        = number
  default     = 10
}

variable "loki_retention_days" {
  description = "Days Loki keeps chunks. Longer in prod."
  type        = number
  default     = 365
}
