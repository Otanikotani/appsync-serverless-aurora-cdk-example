.PHONY: all

all: build

tidy: dep
	@go mod tidy

dep: ## Get the dependencies
	@go mod download

lint: ## Lint Golang files
	@golint ./...

test: ## Run unittests
	@go test ./...

.PHONY: build clean deploy

build:
	env GOOS=linux go build -ldflags="-s -w" -o build/rds-statement-runner $(shell find . -name '*.go' | grep -v _test.go)

zip: build
	zip -j -r9 build/rds-statement-runner.zip build/rds-statement-runner

clean:
	@rm -rf build/