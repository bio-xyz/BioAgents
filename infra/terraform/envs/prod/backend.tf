terraform {
  backend "s3" {
    bucket         = "bioagents-tf-state"
    key            = "envs/prod/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "bioagents-tf-state-lock"
    encrypt        = true
  }
}
