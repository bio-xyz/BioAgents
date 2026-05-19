variable "name" {
  description = "VPC name; also used as a name prefix for subnets and gateways."
  type        = string
}

variable "cidr" {
  description = "Primary CIDR block, e.g. 10.10.0.0/16."
  type        = string
}

variable "az_count" {
  description = "Number of AZs to span (must be <= AZs in region)."
  type        = number
  default     = 3
}

variable "single_nat" {
  description = "Use a single NAT gateway across all AZs (cost) vs one per AZ (HA)."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
