variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-west-2"
}

variable "env_name" {
  description = "Short env name used as a suffix on resource names."
  type        = string
  default     = "staging"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deployer role."
  type        = string
  default     = "BioAgents"
}

variable "github_branch" {
  description = "Branch the deployer role can be assumed from."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "Primary VPC CIDR."
  type        = string
  default     = "10.10.0.0/16"
}

variable "kubernetes_version" {
  description = "Kubernetes minor version for the EKS cluster."
  type        = string
  default     = "1.31"
}

variable "node_instance_types" {
  description = "Instance types for the workers-ondemand managed node group."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "node_min_size" {
  description = "Min nodes in the managed node group."
  type        = number
  default     = 1
}

variable "node_desired_size" {
  description = "Desired nodes in the managed node group."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Max nodes in the managed node group."
  type        = number
  default     = 5
}

variable "loki_retention_days" {
  description = "Days Loki keeps chunks. Staging short, prod longer."
  type        = number
  default     = 90
}
