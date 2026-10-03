"""fit_length — YuE2가 요청보다 긴 악보를 쓸 때 길이 상한에 맞춰 자르는지.

실행(설치된 환경 필요): "$HOME/Library/Application Support/genitor-music/.venv/bin/python" -m unittest discover music-server/tests
고정 자료는 실제 YuE2 플래너 출력(Vocal→Ins 변환본): '짧게' 요청에 226초를 쓴 악보와 63초 악보.
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import engine  # noqa: E402
from abc_tools import parse_abc, report  # noqa: E402  (engine이 설치된 YuE 스킬 경로를 sys.path에 넣는다)
from instrumental import validate_score  # noqa: E402

LONG = (HERE / "fixtures/long-226s.abc").read_text(encoding="utf-8")
SHORT = (HERE / "fixtures/short-63s.abc").read_text(encoding="utf-8")
labels = lambda t: [l[2:] for l in t.splitlines() if l.startswith("% ")]


class FitLength(unittest.TestCase):
    def test_trims_long_score_under_limit_and_keeps_outro(self):
        for limit in engine.MAX_SECONDS.values():
            out, info = engine.fit_length(LONG, limit)
            self.assertTrue(info["trimmed"])
            self.assertLessEqual(info["seconds_after"], limit)
            self.assertEqual(labels(out)[0], "intro")
            self.assertEqual(labels(out)[-1], "outro")
            validate_score(out)  # 원본 스킬 검증기를 그대로 통과해야 렌더링할 수 있다
            self.assertAlmostEqual(float(report(parse_abc(out))["nominal_duration_seconds"]), info["seconds_after"], places=0)

    def test_short_score_is_untouched(self):
        out, info = engine.fit_length(SHORT, engine.MAX_SECONDS["short"])
        self.assertFalse(info["trimmed"])
        self.assertEqual(out, SHORT)


if __name__ == "__main__":
    unittest.main()
