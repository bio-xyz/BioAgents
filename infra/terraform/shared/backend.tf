terraform {
  backend "s3" {
    bucket       = "bioagents-tf-state"
    key          = "shared/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}
