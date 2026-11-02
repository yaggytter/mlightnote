.PHONY: vuln web-test web-typecheck web-build web-dev e2e test verify deploy docker-smoke

# Dependency vulnerability scan of production dependencies.
vuln:
	npm audit --omit=dev

web-test:
	npm run test --workspace mlightnote-web

web-typecheck:
	npm run typecheck --workspace mlightnote-web

web-build:
	npm run build --workspace mlightnote-web

web-dev:
	npm run dev --workspace mlightnote-web

e2e:
	npm run test:e2e

# Rebuild and restart the static site so the latest code is live at
# http://127.0.0.1:$${MLIGHTNOTE_PORT:-8080}, then smoke-test it in a real
# browser (production build, nginx, CSP).
deploy:
	docker compose build
	docker compose up -d --wait --remove-orphans
	$(MAKE) docker-smoke

docker-smoke:
	node_modules/.bin/playwright test --config playwright.docker.config.ts

test: web-test

verify: web-test web-typecheck web-build

