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
	vsce package

publish: compile
	vsce publish

clean:
	rm -rf dist *.vsix
