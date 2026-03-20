.PHONY: build compile watch lint test package publish clean install

build: install compile

install:
	npm install

compile:
	npm run compile

watch:
	npm run watch

lint:
	npm run lint

test:
	npm run test

package: compile
	npx vsce package

publish: compile
	npx vsce publish

clean:
	rm -rf dist *.vsix
