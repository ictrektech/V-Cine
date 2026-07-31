"""Tests for scene mode handler."""

from lib.modes import REGISTRY


class TestSceneMode:
    """scene mode: semantic scene search."""

    def test_help(self):
        handler = REGISTRY["scene"]
        assert handler.name == "scene"

    def test_scene_search_output(self, mock_api, config):
        """scene search should produce proper TOON."""
        mock_api.scene_search.return_value = {
            "data": [
                {
                    "scene_index": 3,
                    "start_time": 754,
                    "end_time": 776,
                    "description": "雨夜中的追逐场景",
                    "distance": 0.15,
                    "media_id": "uuid-1",
                    "media_title": "盗梦空间",
                },
            ],
        }
        handler = REGISTRY["scene"]
        args = MockArgs(query="雨夜追逐", mode="text", limit=20, task_id=None)
        output = handler.handle(args, config, mock_api)
        assert "mode: scene" in output
        assert "total: 1" in output
        assert "盗梦空间" in output
        assert "雨夜中的追逐场景" in output
        assert "00:12:34" in output  # start_time formatted
        assert "00:12:56" in output  # end_time formatted
        mock_api.scene_search.assert_called_once_with("雨夜追逐", limit=20, mode="text")

    def test_scene_search_image_mode(self, mock_api, config):
        """--mode image should pass mode=image to API."""
        mock_api.scene_search.return_value = {"data": []}
        handler = REGISTRY["scene"]
        args = MockArgs(query="explosion", mode="image", limit=10, task_id=None)
        output = handler.handle(args, config, mock_api)
        assert "search_mode: image" in output
        mock_api.scene_search.assert_called_once_with(
            "explosion", limit=10, mode="image"
        )

    def test_scene_search_no_query(self, mock_api, config):
        """No query should return error."""
        handler = REGISTRY["scene"]
        args = MockArgs(query=None, mode="text", limit=20, task_id=None)
        output = handler.handle(args, config, mock_api)
        assert "error" in output

    def test_scene_list(self, mock_api, config):
        """scene_list should show all scenes of a task."""
        mock_api.scene_list.return_value = {
            "scenes": [
                {
                    "scene_index": 0,
                    "start_time": "00:00:00",
                    "end_time": "00:01:23",
                    "description": "开场画面",
                    "status": "completed",
                },
            ],
        }
        handler = REGISTRY["scene"]
        args = MockArgs(query=None, mode="text", limit=20, task_id="task-abc")
        output = handler.handle(args, config, mock_api)
        assert "mode: scene_list" in output
        assert "total: 1" in output
        assert "task-abc" in output
        assert "开场画面" in output
        mock_api.scene_list.assert_called_once_with("task-abc")

    def test_scene_list_empty(self, mock_api, config):
        """Empty scene list should still produce valid TOON."""
        mock_api.scene_list.return_value = {"scenes": []}
        handler = REGISTRY["scene"]
        args = MockArgs(query=None, mode="text", limit=20, task_id="task-empty")
        output = handler.handle(args, config, mock_api)
        assert "mode: scene_list" in output
        assert "total: 0" in output


class MockArgs:
    """Simple argparse.Namespace stand-in."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
