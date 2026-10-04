"""가사 정리와 가사 줄 타이밍.

고정 자료는 실제 YuE2 노래 악보(102초)와, ChatGPT가 만든 그대로의 가사(제목·마크다운·[Verse 1] 포함).
"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import engine  # noqa: E402,F401  (YuE 스킬 스크립트 경로 등록)
from lyrics import clean_lyrics, lyric_sections, lyric_timing  # noqa: E402

ABC = (HERE / "fixtures/song-102s.abc").read_text(encoding="utf-8")
RAW = (HERE / "fixtures/song-102s-lyrics.txt").read_text(encoding="utf-8")


class CleanLyrics(unittest.TestCase):
    def test_drops_title_markdown_and_tag_numbers(self):
        out = clean_lyrics(RAW)
        self.assertTrue(out.startswith("[Verse]\n눈을 감으면"))
        self.assertNotIn("**", out)
        self.assertNotIn("하늘을 나는 꿈", out)
        self.assertIn("[Pre-Chorus]", out)
        self.assertEqual([l for l, _ in lyric_sections(out)], ["verse", "pre-chorus", "chorus", "outro"])

    def test_untagged_lyrics_are_kept(self):
        self.assertEqual(clean_lyrics("첫 줄  \n둘째 줄"), "첫 줄\n둘째 줄")


class LyricTiming(unittest.TestCase):
    def setUp(self):
        self.lines = lyric_timing(ABC, clean_lyrics(RAW))

    def test_every_line_in_order(self):
        self.assertEqual(len(self.lines), 13)
        starts = [l["start"] for l in self.lines]
        self.assertEqual(starts, sorted(starts))
        self.assertTrue(all(l["end"] > l["start"] for l in self.lines))

    def test_verse_pickup_and_even_phrases(self):
        verse = [l for l in self.lines if l["section"] == "verse"]
        # 첫 줄은 인트로 끝의 못갖춘마디(16.75초)에서 시작, 네 줄은 각각 약 8초(4마디)
        self.assertAlmostEqual(verse[0]["start"], 16.75, places=2)
        gaps = [b["start"] - a["start"] for a, b in zip(verse, verse[1:])]
        for g in gaps:
            self.assertAlmostEqual(g, 8.0, delta=0.6)

    def test_short_rests_split_by_syllables(self):
        pre = [l for l in self.lines if l["section"] == "pre-chorus"]
        a, b = (l["end"] - l["start"] for l in pre)
        self.assertLess(max(a, b) / min(a, b), 2.0)  # 쉼이 짧아도 한쪽으로 쏠리지 않는다


if __name__ == "__main__":
    unittest.main()


class MergeAlignment(unittest.TestCase):
    """align.merge — 정렬 결과와 악보 기반 값 합치기(모델 없이)."""

    def setUp(self):
        import align
        self.align = align
        self.score = [{"start": 17.0, "end": 24.0, "text": "a", "section": "verse"},
                      {"start": 25.0, "end": 32.0, "text": "b", "section": "verse"},
                      {"start": 33.0, "end": 40.0, "text": "c", "section": "verse"}]

    def test_confident_lines_use_vocal_timing(self):
        out = self.align.merge(self.score, [(15.0, 20.0, 0.8), (23.0, 28.0, 0.7), (31.0, 36.0, 0.75)])
        self.assertEqual([l["start"] for l in out], [15.0, 23.0, 31.0])
        self.assertTrue(all(l["source"] == "vocal" for l in out))

    def test_low_confidence_line_falls_back_with_median_shift(self):
        # 가운데 줄은 신뢰도가 낮다 → 악보 값(25.0) + 확실한 줄들의 차이 중앙값(−2.0)
        out = self.align.merge(self.score, [(15.0, 20.0, 0.8), (60.0, 61.0, 0.1), (31.0, 36.0, 0.75)])
        self.assertEqual(out[1]["source"], "score")
        self.assertAlmostEqual(out[1]["start"], 23.0)

    def test_nothing_aligned_keeps_score_timing(self):
        out = self.align.merge(self.score, [None, None, None])
        self.assertEqual([l["start"] for l in out], [17.0, 25.0, 33.0])
