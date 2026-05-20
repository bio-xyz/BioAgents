data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Split the primary /16 into /20 chunks: first az_count for private, next
  # az_count for public. Plenty of room for future use.
  private_subnets = [for i in range(var.az_count) : cidrsubnet(var.cidr, 4, i)]
  public_subnets  = [for i in range(var.az_count) : cidrsubnet(var.cidr, 4, i + var.az_count)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.13"

  name = var.name
  cidr = var.cidr

  azs             = local.azs
  private_subnets = local.private_subnets
  public_subnets  = local.public_subnets

  enable_nat_gateway = true
  single_nat_gateway = var.single_nat

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags required by EKS for subnet auto-discovery + LB controller.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = var.tags
}
