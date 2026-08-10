# AWS CLI로 youtube EC2 + SG + Elastic IP 생성 (Windows PowerShell)
# 사전: AWS CLI v2 설치, aws configure, 키 페어 존재
#
#   $env:KEY_NAME = "my-keypair"
#   $env:MY_IP = (Invoke-RestMethod https://checkip.amazonaws.com).Trim() + "/32"
#   powershell -ExecutionPolicy Bypass -File deploy/ec2-create-instance.ps1

$ErrorActionPreference = "Stop"

$Region = if ($env:AWS_REGION) { $env:AWS_REGION } else { "ap-northeast-2" }
$InstanceType = if ($env:INSTANCE_TYPE) { $env:INSTANCE_TYPE } else { "t3.medium" }
$VolumeGib = if ($env:VOLUME_GIB) { [int]$env:VOLUME_GIB } else { 8 }
$KeyName = $env:KEY_NAME
$MyIp = $env:MY_IP
$NameTag = if ($env:NAME_TAG) { $env:NAME_TAG } else { "youtube-app" }
$SgName = if ($env:SG_NAME) { $env:SG_NAME } else { "youtube-ec2-sg" }

if (-not $KeyName) { throw "KEY_NAME 환경변수(키 페어 이름) 필수" }
if (-not $MyIp) { throw "MY_IP 환경변수(예: 1.2.3.4/32) 필수" }

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI 없음. https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
}

Write-Host "== region=$Region type=$InstanceType key=$KeyName ssh_from=$MyIp =="

$AmiId = aws ec2 describe-images `
  --region $Region `
  --owners 099720109477 `
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" `
  --query "sort_by(Images,&CreationDate)[-1].ImageId" `
  --output text
Write-Host "AMI=$AmiId"

$VpcId = aws ec2 describe-vpcs `
  --region $Region `
  --filters "Name=isDefault,Values=true" `
  --query "Vpcs[0].VpcId" `
  --output text
Write-Host "VPC=$VpcId"

$ExistingSg = aws ec2 describe-security-groups `
  --region $Region `
  --filters "Name=group-name,Values=$SgName" "Name=vpc-id,Values=$VpcId" `
  --query "SecurityGroups[0].GroupId" `
  --output text 2>$null

if ($ExistingSg -and $ExistingSg -ne "None") {
  $SgId = $ExistingSg
  Write-Host "기존 SG 사용: $SgId"
} else {
  $SgId = aws ec2 create-security-group `
    --region $Region `
    --group-name $SgName `
    --description "youtube app: SSH(owner) + HTTP" `
    --vpc-id $VpcId `
    --query GroupId `
    --output text
  Write-Host "SG 생성: $SgId"
  $IpPerms = @"
[
  {"IpProtocol":"tcp","FromPort":22,"ToPort":22,"IpRanges":[{"CidrIp":"$MyIp","Description":"SSH-owner"}]},
  {"IpProtocol":"tcp","FromPort":80,"ToPort":80,"IpRanges":[{"CidrIp":"0.0.0.0/0","Description":"HTTP"}]}
]
"@
  aws ec2 authorize-security-group-ingress --region $Region --group-id $SgId --ip-permissions $IpPerms
}

$SubnetId = aws ec2 describe-subnets `
  --region $Region `
  --filters "Name=vpc-id,Values=$VpcId" "Name=default-for-az,Values=true" `
  --query "Subnets[0].SubnetId" `
  --output text

$Bdm = "[{`"DeviceName`":`"/dev/sda1`",`"Ebs`":{`"VolumeSize`":$VolumeGib,`"VolumeType`":`"gp3`",`"DeleteOnTermination`":true}}]"
$Tags = "ResourceType=instance,Tags=[{Key=Name,Value=$NameTag}]"

$InstanceId = aws ec2 run-instances `
  --region $Region `
  --image-id $AmiId `
  --instance-type $InstanceType `
  --key-name $KeyName `
  --security-group-ids $SgId `
  --subnet-id $SubnetId `
  --associate-public-ip-address `
  --block-device-mappings $Bdm `
  --tag-specifications $Tags `
  --query "Instances[0].InstanceId" `
  --output text
Write-Host "INSTANCE=$InstanceId"
aws ec2 wait instance-running --region $Region --instance-ids $InstanceId

$AllocId = aws ec2 allocate-address --region $Region --domain vpc --query AllocationId --output text
aws ec2 associate-address --region $Region --instance-id $InstanceId --allocation-id $AllocId | Out-Null
$PublicIp = aws ec2 describe-addresses --region $Region --allocation-ids $AllocId --query "Addresses[0].PublicIp" --output text

Write-Host ""
Write-Host "=== 완료 ==="
Write-Host "InstanceId: $InstanceId"
Write-Host "ElasticIP:  $PublicIp"
Write-Host "SSH:        ssh -i <key.pem> ubuntu@$PublicIp"
Write-Host "다음:       SSH 후 git clone → bash deploy/ec2-bootstrap.sh"
Write-Host "문서:       deploy/EC2-MySQL-setup.md"
