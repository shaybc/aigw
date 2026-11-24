"""Check runner orchestration without requiring an installed SDK or model."""
import os
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.sdk = types.ModuleType("openhands.sdk")
        for name in ("LLM", "Agent", "Conversation", "Tool"):
            setattr(self.sdk, name, MagicMock())
        self.dotenv = types.ModuleType("dotenv")
        self.dotenv.load_dotenv = MagicMock()
        self.modules = {"dotenv": self.dotenv, "openhands.sdk": self.sdk}
        for module, name in (("file_editor", "FileEditorTool"), ("task_tracker", "TaskTrackerTool"), ("terminal", "TerminalTool")):
            tool = types.ModuleType(f"openhands.tools.{module}")
            setattr(tool, name, types.SimpleNamespace(name=module))
            self.modules[tool.__name__] = tool
        self.runner = runpy.run_path(str(Path(__file__).resolve().parents[1] / "ohands.py"))
        self.main = self.runner["main"]
        self.globals = self.main.__globals__

    def test_default_connection_and_prompt_execution(self):
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, self.modules):
            self.main()
            options = self.sdk.LLM.call_args.kwargs
            self.assertEqual(options["base_url"], "http://127.0.0.1:3100/v1")
            self.assertEqual(options["model"], "openai/gemini-2.5-pro")
            self.assertEqual(options["api_mode"], "chat")
            self.assertTrue(options["native_tool_calling"])
            self.assertFalse(options["stream"])
            self.assertEqual(os.environ["LITELLM_LOCAL_MODEL_COST_MAP"], "true")
            self.assertEqual(os.environ["LITELLM_OFFLINE_MODE"], "true")
            self.assertEqual(self.sdk.Tool.call_count, 3)
            conversation = self.sdk.Conversation.return_value
            conversation.send_message.assert_called_once_with(self.runner["PROMPT"].strip())
            conversation.run.assert_called_once_with()
            conversation.close.assert_called_once_with()
            self.dotenv.load_dotenv.assert_called_once_with(Path(self.runner["__file__"]).resolve().parent / ".env")

    def test_environment_overrides_and_cleanup_on_failure(self):
        settings = {"LLM_MODEL": "openai/enterprise-model", "LLM_BASE_URL": "http://gateway:3100/v1", "LLM_MAX_OUTPUT_TOKENS": "4096", "AIGW_MAX_ITERATIONS": "12"}
        self.sdk.Conversation.return_value.run.side_effect = RuntimeError("model failed")
        with patch.dict(os.environ, settings, clear=True), patch.dict(sys.modules, self.modules):
            with self.assertRaisesRegex(RuntimeError, "model failed"):
                self.main()
        self.assertEqual(self.sdk.LLM.call_args.kwargs["model"], "openai/enterprise-model")
        self.assertEqual(self.sdk.LLM.call_args.kwargs["base_url"], "http://gateway:3100/v1")
        self.assertEqual(self.sdk.LLM.call_args.kwargs["max_output_tokens"], 4096)
        self.assertEqual(self.sdk.Conversation.call_args.kwargs["max_iteration_per_run"], 12)
        self.sdk.Conversation.return_value.close.assert_called_once_with()

    def test_empty_prompt_is_rejected_before_sdk_calls(self):
        self.globals["PROMPT"] = "   "
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, self.modules):
            with self.assertRaisesRegex(ValueError, "multiline PROMPT"):
                self.main()
        self.sdk.LLM.assert_not_called()

    def test_missing_workspace_is_rejected_before_sdk_calls(self):
        self.globals["WORKSPACE"] = Path(__file__).parent / "missing-aigw-workspace"
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, self.modules):
            with self.assertRaisesRegex(ValueError, "not a directory"):
                self.main()
        self.sdk.LLM.assert_not_called()


if __name__ == "__main__":
    unittest.main()
