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

build: build_fetch

build_fetch:
	env GOOS=linux go build -ldflags="-s -w" -o build/fetch $(shell find fetch/ -name '*.go' | grep -v _test.go)

zip: build fetch_zip

fetch_zip: build_fetch
	zip -j -r9 build/fetch.zip build/fetch

clean:
	@rm -rf build/

deploy: clean build zip
	terraform apply -auto-approve

