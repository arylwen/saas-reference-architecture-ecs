#!/bin/bash
awslocal neptune create-db-cluster --engine neptune  --db-cluster-identifier aws-resource-graph-cluster --region us-east-1
awslocal neptune create-db-instance  --db-cluster-identifier aws-resource-graph-cluster  --db-instance-identifier aws-resource-graph-instance --engine neptune --db-instance-class db.t3.medium --region us-east-1

