YEAR ?= 2023
REGION ?= statewide
UV ?= uv

.PHONY: setup download inspect lookup process tiles regions basemap all test

setup:
	$(UV) sync --frozen
	@for tool in ogr2ogr tippecanoe pmtiles; do \
		command -v $$tool >/dev/null 2>&1 && echo "found $$tool" || echo "missing $$tool (brew install gdal tippecanoe pmtiles)"; \
	done

download:
	$(UV) run python pipeline/01_download.py --year $(YEAR)

inspect:
	$(UV) run python pipeline/02_inspect.py --year $(YEAR)

lookup process tiles regions basemap:
	@echo "$@: not yet"

all: lookup process tiles regions basemap

test:
	$(UV) run pytest tests/pipeline -q
