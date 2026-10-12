import re

import pytest

import common


def test_2023_url_table():
    source = common.year_source(2023)
    assert source.url == (
        "https://data.cnra.ca.gov/dataset/6c3d65e3-35bb-49e1-a51e-49d5a2cf09a9/resource/"
        "25d0f174-4bec-4987-a402-602cd1372786/download/i15_crop_mapping_final_2023.zip"
    )
    assert source.zip_name == "i15_crop_mapping_final_2023.zip"
    assert common.LEGEND_URL.endswith("2022-dwr-standard-land-use-legend-remote-sensing-version.pdf")


def test_unknown_year_exits():
    with pytest.raises(SystemExit):
        common.year_source(1999)


def test_paths_are_per_year():
    assert common.raw_dir(2023) == common.RAW_DIR / "2023"
    assert common.zip_path(2023).parent == common.raw_dir(2023)
    assert common.legend_path(2023).name == "legend.pdf"


def test_legend_describe_without_pdf():
    legend = common.Legend(
        classes={"D": "DECIDUOUS FRUITS AND NUTS", "V": "VINEYARDS"},
        subclasses={"D": {12: "Almonds"}},
    )
    assert legend.describe("D12") == "Deciduous fruits and nuts: Almonds"
    assert legend.describe("V") == "Grapes"
    assert legend.describe("Q9") == "(not in legend)"
    assert "not in legend" in legend.describe("D99")


@pytest.mark.skipif(not common.legend_path(2023).exists(), reason="legend PDF not downloaded")
def test_parse_real_legend():
    legend = common.parse_legend(common.legend_path(2023))
    assert legend.describe("D12").endswith("Almonds")
    assert legend.describe("T20").endswith("Strawberries")
    assert legend.describe("C5").endswith("Avocados")
    assert re.fullmatch(r"[A-Z]+", "".join(legend.classes))
