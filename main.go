package main

import (
	"context"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/rdsdataservice"
	"log"
	"os"
	"strings"
)

type CustomResourceEvent struct {
	RequestType string `json:"RequestType"`
}

func main() {
	lambda.Start(handler)
}

func handler(_ context.Context, event CustomResourceEvent) {
	log.Printf("Event: %s", event.RequestType)
	if event.RequestType == "Create" {
		onCreate()
	}
	//Don't really care about other types of events. "Update", "Delete"
}

func onCreate() {
	dbArn, ok := os.LookupEnv("DB_ARN")
	if !ok {
		log.Fatalf("DB_ARN env variable is not set")
	}
	secretArn, ok := os.LookupEnv("SECRET_ARN")
	if !ok {
		log.Fatalf("SECRET_ARN env variable is not set")
	}
	dbName, ok := os.LookupEnv("DATABASE_NAME")
	if !ok {
		log.Fatalf("DATABASE_NAME env variable is not set")
	}

	var statements []string

	for _, envKeyValue := range os.Environ() {
		if strings.HasPrefix(envKeyValue, "STATEMENT_") {
			statement := strings.Split(envKeyValue, "=")[1]
			statements = append(statements, statement)
		}
	}

	sess, err := session.NewSession()
	if err != nil {
		log.Fatalf("Failed to open a session: %v\n", err)
	}
	svc := rdsdataservice.New(sess)

	for _, statement := range statements {
		input := &rdsdataservice.ExecuteStatementInput{
			Database:    aws.String(dbName),
			ResourceArn: aws.String(dbArn),
			SecretArn:   aws.String(secretArn),
			Sql:         aws.String(statement),
		}

		log.Printf("Executing statement: %s\n", input)
		output, err := svc.ExecuteStatement(input)
		if err != nil {
			if awsErr, ok := err.(awserr.Error); ok {
				log.Fatalf("Failed to execute statement %s:\nCode: %s\nMessage: %s\nOrig Message:%v\n", statement,
					awsErr.Code(), awsErr.Message(), awsErr.OrigErr())
			}

		}
		log.Print(output)
	}
}
