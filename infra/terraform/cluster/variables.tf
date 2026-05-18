variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-west-2"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deployer roles."
  type        = string
  default     = "BioAgents"
}

variable "staging_branch" {
  description = "Branch the staging deployer role can be assumed from."
  type        = string
  default     = "dev"
}

variable "prod_branch" {
  description = "Branch the prod deployer role can be assumed from."
  type        = string
  default     = "main"
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
  description = "Min nodes — must cover the floor request of both namespaces (~3.5 vCPU at min replicas + Loki + system pods)."
  type        = number
  default     = 2
}

variable "node_desired_size" {
  description = "Initial node count. KEDA-driven peaks push higher, autoscaler grows to node_max_size."
  type        = number
  default     = 3
}

variable "node_max_size" {
  description = "Ceiling sized for combined KEDA peaks: staging max ~4.5 vCPU + prod max ~8.5 vCPU + Loki + headroom."
  type        = number
  default     = 12
}

variable "loki_retention_days" {
  description = "S3 expiry horizon. Chunks rest in GLACIER_IR after glacier_transition_days until this expiry."
  type        = number
  default     = 730
}

variable "loki_glacier_transition_days" {
  description = "Days before Loki chunks transition from STANDARD to GLACIER_IR for cold backup. Aligned with Loki's max_query_lookback (90d) — older chunks aren't queryable through Grafana anyway."
  type        = number
  default     = 90
}

variable "staging_quota" {
  description = "ResourceQuota for the bioagents-staging namespace. Sized from staging overlay's KEDA max replicas × base requests + ~50% headroom."
  type = object({
    cpu_requests = string
    cpu_limits   = string
    memory       = string
    pods         = string
  })
  default = {
    cpu_requests = "6"
    cpu_limits   = "12"
    memory       = "12Gi"
    pods         = "30"
  }
}

variable "prod_quota" {
  description = "ResourceQuota for the bioagents-prod namespace. Sized from prod overlay's higher KEDA max replicas."
  type = object({
    cpu_requests = string
    cpu_limits   = string
    memory       = string
    pods         = string
  })
  default = {
    cpu_requests = "14"
    cpu_limits   = "28"
    memory       = "24Gi"
    pods         = "60"
  }
}
