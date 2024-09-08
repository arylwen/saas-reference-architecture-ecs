#!/bin/bash

# build and push application services into ECR

export DOCKER_DEFAULT_PLATFORM=linux/amd64

service_repos=("user" "product" "order" "rproxy")

deploy_service () {

    local SERVICE_NAME="$1"

    if [[ -z "$SERVICE_NAME" ]]; then
      echo "Please provide a SERVICE NAME"
      exit 1
    fi

    local REGION=$(aws --endpoint-url=https://localhost:4566 --no-verify-ssl ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
    local ACCOUNT_ID=$(aws --endpoint-url=https://localhost:4566 --no-verify-ssl sts get-caller-identity --query Account --output text)
    #local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE_NAME"
    local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.localhost.localstack.cloud:4566/$SERVICE_NAME"

    CWD=$(pwd)
    cd ../server/application
    local REGISTRY=$(echo $SERVICEECR| cut -d'/' -f 1)

    #no beed to login into the localstack registry
    #aws --endpoint-url=https://localhost:4566 --no-verify-ssl ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY
    docker build -t $SERVICEECR -f Dockerfile.$SERVICE_NAME .
    docker push $SERVICEECR:latest

    cd $CWD
    echo '************************' 
    echo '************************' 
    echo ""
    echo "$SERVICE_NAME SERVICE_ECR_REPO:" $SERVICEECR
    echo "AWS_REGION:" $REGION

}

##export service_repos;
for repository in "${service_repos[@]}"
do
echo $repository
  aws --endpoint-url=https://localhost:4566 --no-verify-ssl ecr describe-repositories --repository-names "$repository" 2>/dev/null || echo "ECR Repository '$repository' does not exist. Creating..." && 
  aws --endpoint-url=https://localhost:4566 --no-verify-ssl ecr create-repository --repository-name "$repository"
  deploy_service $repository
done
