YEAR ?= 2023
REGION ?= statewide
UV ?= uv

.PHONY: setup download inspect lookup process tiles overview fields-low regions basemap all test

setup:
	$(UV) sync --frozen
	@for tool in ogr2ogr tippecanoe pmtiles; do \
		command -v $$tool >/dev/null 2>&1 && echo "found $$tool" || echo "missing $$tool (brew install gdal tippecanoe pmtiles)"; \
	done

download:
	$(UV) run python pipeline/01_download.py --year $(YEAR)

inspect:
	$(UV) run python pipeline/02_inspect.py --year $(YEAR)

lookup:
	$(UV) run python pipeline/03_lookup.py

process:
	$(UV) run python pipeline/04_process.py --year $(YEAR) --region $(REGION)

tiles:
	YEAR=$(YEAR) REGION=$(REGION) pipeline/05_tiles.sh

overview:
	$(UV) run python pipeline/07_overview.py --year $(YEAR) --region $(REGION)

fields-low:
	YEAR=$(YEAR) REGION=$(REGION) pipeline/08_fields_low.sh

regions:
	$(UV) run python pipeline/06_regions.py --year $(YEAR) --region $(REGION)

basemap:
	@echo "$@: not yet"

all: lookup process tiles overview fields-low regions basemap

test:
	$(UV) run pytest tests/pipeline -q
