#!/usr/bin/env bash
# AWS CLI로 youtube 앱용 EC2 + 보안그룹 + Elastic IP 생성 (ap-northeast-2)
# 사전: aws configure 완료, 키 페어 이름 준비
#
# 사용:
#   export KEY_NAME=my-keypair
#   export MY_IP=$(curl -s https://checkip.amazonaws.com)/32   # SSH 허용 IP
#   bash deploy/ec2-create-instance.sh
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-2}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"
VOLUME_GIB="${VOLUME_GIB:-8}"
KEY_NAME="${KEY_NAME:?KEY_NAME=키페어이름 필수}"
MY_IP="${MY_IP:?MY_IP=x.x.x.x/32 필수 (본인 공인 IP)}"
NAME_TAG="${NAME_TAG:-youtube-app}"
SG_NAME="${SG_NAME:-youtube-ec2-sg}"

echo "== region=${REGION} type=${INSTANCE_TYPE} key=${KEY_NAME} ssh_from=${MY_IP} =="

# Ubuntu 22.04 LTS (canonical) — 공식 SSM 파라미터
AMI_ID="$(
  aws ec2 describe-images \
    --region "$REGION" \
    --owners 099720109477 \
    --filters \
      "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
      "Name=state,Values=available" \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
    --output text
)"
echo "AMI=${AMI_ID}"

VPC_ID="$(
  aws ec2 describe-vpcs \
    --region "$REGION" \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' \
    --output text
)"
echo "VPC=${VPC_ID}"

EXISTING_SG="$(
  aws ec2 describe-security-groups \
    --region "$REGION" \
    --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || true
)"
if [[ -n "${EXISTING_SG}" && "${EXISTING_SG}" != "None" ]]; then
  SG_ID="$EXISTING_SG"
  echo "기존 SG 사용: ${SG_ID}"
else
  SG_ID="$(
    aws ec2 create-security-group \
      --region "$REGION" \
      --group-name "$SG_NAME" \
      --description "youtube app: SSH(owner) + HTTP" \
      --vpc-id "$VPC_ID" \
      --query GroupId \
      --output text
  )"
  echo "SG 생성: ${SG_ID}"
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP},Description=SSH-owner}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]"
  # 3306 은 의도적으로 열지 않음
fi

SUBNET_ID="$(
  aws ec2 describe-subnets \
    --region "$REGION" \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=default-for-az,Values=true" \
    --query 'Subnets[0].SubnetId' \
    --output text
)"

INSTANCE_ID="$(
  aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --subnet-id "$SUBNET_ID" \
    --associate-public-ip-address \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${VOLUME_GIB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME_TAG}}]" \
    --query 'Instances[0].InstanceId' \
    --output text
)"
echo "INSTANCE=${INSTANCE_ID}"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

ALLOC_ID="$(
  aws ec2 allocate-address \
    --region "$REGION" \
    --domain vpc \
    --query AllocationId \
    --output text
)"
aws ec2 associate-address \
  --region "$REGION" \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID" >/dev/null

PUBLIC_IP="$(
  aws ec2 describe-addresses \
    --region "$REGION" \
    --allocation-ids "$ALLOC_ID" \
    --query 'Addresses[0].PublicIp' \
    --output text
)"

echo ""
echo "=== 완료 ==="
echo "InstanceId: ${INSTANCE_ID}"
echo "ElasticIP:  ${PUBLIC_IP}"
echo "SSH:        ssh -i <key.pem> ubuntu@${PUBLIC_IP}"
echo "다음:       SSH 후 bash deploy/ec2-bootstrap.sh  (레포 clone 후)"
echo "문서:       deploy/EC2-MySQL-setup.md"
