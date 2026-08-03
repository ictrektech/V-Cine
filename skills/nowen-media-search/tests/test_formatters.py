"""Tests for TOON formatter output."""

import pytest

from lib.formatters import encode


class TestEncodeScalars:

    def test_string(self):
        assert encode({"name": "hello"}) == "name: hello"

    def test_int(self):
        assert encode({"count": 42}) == "count: 42"

    def test_float(self):
        assert encode({"rating": 8.7}) == "rating: 8.7"

    def test_none(self):
        assert encode({"value": None}) == "value: -"

    def test_bool(self):
        assert encode({"active": True}) == "active: true"

    def test_empty_string(self):
        result = encode({"name": ""})
        assert 'name: ""' in result

    def test_string_with_comma(self):
        result = encode({"genres": "科幻,冒险"})
        assert '"科幻,冒险"' in result


class TestEncodeDict:

    def test_simple_dict(self):
        data = {"mode": "stats", "total": 3}
        result = encode(data)
        assert "mode: stats" in result
        assert "total: 3" in result

    def test_nested_dict(self):
        data = {"server": {"version": "1.2", "status": "ok"}}
        result = encode(data)
        assert "server:" in result
        assert "version: 1.2" in result
        assert "status: ok" in result


class TestEncodeList:

    def test_empty_list(self):
        result = encode({"results": []})
        assert "results[0" in result

    def test_list_of_dicts(self):
        data = {
            "results": [
                {"id": "a", "title": "Movie A"},
                {"id": "b", "title": "Movie B"},
            ]
        }
        result = encode(data)
        assert "results[2" in result
        assert "id: a" in result
        assert "title: Movie A" in result


class TestSearchOutput:

    def test_search_result_shape(self):
        """Realistic search output should have correct structure."""
        data = {
            "mode": "search",
            "query": "肖申克",
            "total": 1,
            "page": 1,
            "results": [
                {
                    "id": "2589729f",
                    "title": "肖申克的救赎",
                    "year": 1994,
                    "type": "movie",
                    "rating": 8.7,
                    "genres": "剧情,犯罪",
                }
            ],
        }
        result = encode(data)
        assert result.startswith("mode: search")
        assert "total: 1" in result
        assert "肖申克的救赎" in result
        assert '"剧情,犯罪"' in result

    def test_empty_results(self):
        """Empty results should still produce valid TOON."""
        data = {"mode": "search", "query": "xxx", "total": 0, "page": 1, "results": []}
        result = encode(data)
        assert "total: 0" in result
        assert "results[0" in result
