output "vpc_id" {
  description = "VPC ID."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs. EKS nodes live here."
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet IDs. Public-facing LBs only."
  value       = module.vpc.public_subnets
}

output "azs" {
  description = "AZs the VPC spans."
  value       = module.vpc.azs
}
