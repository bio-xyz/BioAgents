# Account-wide resources. Currently only the GitHub Actions OIDC provider —
# one per AWS account, referenced by every per-env deployer role.

# Thumbprint values published by GitHub. AWS no longer strictly checks these,
# but the field is still required. See:
# https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
