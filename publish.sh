sam build
sam package --s3-bucket aws-sam-cli-managed-default-samclisourcebucket-1q52gionhjeg3 --output-template-file CSVImport.yml
sam publish --template-file CSVImport.yml
