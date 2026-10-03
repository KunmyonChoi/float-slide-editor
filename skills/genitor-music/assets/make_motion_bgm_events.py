# 모션그래픽 BGM 악보: A minor, 120 BPM, 24마디(48초). 싱크 포인트가 분명하도록 설계.
import json
from fractions import Fraction as F
H, Q = F(1,2), F(1)
bars = {}
def bar(n, notes): bars[n] = notes
# intro 1-4: "1, 2&, 4" 스탭 (시그니처 싱코페이션)
for n, tones in zip(range(1,5), [(69,72,76),(69,72,77),(67,72,76),(67,71,74)]):
    bar(n, [(0,H,tones[0]),(F(3,2),H,tones[1]),(3,H,tones[2])])
# verse 5-8: 빌드, 8마디는 8분음 상승 후 4박 쉼(breath)
bar(5, [(0,Q,76),(1,H,74),(F(3,2),H,72),(2,2,69)])
bar(6, [(0,Q,72),(1,H,74),(F(3,2),H,76),(2,2,77)])
bar(7, [(0,Q,79),(1,H,77),(F(3,2),H,76),(2,2,72)])
bar(8, [(0,H,67),(H,H,71),(1,H,74),(F(3,2),H,76),(2,H,79),(F(5,2),H,81)])
# chorus 9-16: 드롭 훅
hook = [
 [(0,Q,81),(1,H,79),(F(3,2),Q,76),(F(5,2),H,76),(3,Q,79)],
 [(0,H,77),(H,H,76),(1,Q,77),(2,2,72)],
 [(0,Q,79),(1,H,76),(F(3,2),Q,72),(F(5,2),H,74),(3,Q,76)],
 [(0,Q,74),(1,H,71),(F(3,2),H,74),(2,2,79)],
]
for i in range(4): bar(9+i, hook[i]); bar(13+i, hook[i]); bar(19+i, hook[i])
# bridge 17-18: 스톱타임 — 1박, 2&에 히트 후 정적
bar(17, [(0,H,81),(F(3,2),H,81)])
bar(18, [(0,H,79),(F(3,2),H,79),(3,H,74),(F(7,2),H,71)])
# outro 23-24: 23마디 1박 최종 히트, 이후 잔향
bar(23, [(0,4,69)])
bar(24, [])
notes = []
for n in sorted(bars):
    for on, d, p in bars[n]:
        t = F(4*(n-1)) + F(on)
        notes.append([str(t), str(F(d)), p])
loop = ["Am","F","C","G"]
chords = []
for n in range(1,25):
    c = {17:"F",18:"G",23:"Am",24:"Am"}.get(n, loop[(n-(19 if n>=19 else 1))%4])
    chords.append([str(4*(n-1)), c])
# 같은 화음 연속은 합친다
merged = [c for i,c in enumerate(chords) if i==0 or c[1]!=chords[i-1][1]]
sec = {1:"intro",5:"verse",9:"chorus",17:"bridge",19:"chorus",23:"outro"}
barspec = [({"meter":"4/4","section":sec[n]} if n in sec else {}) for n in range(1,25)]
json.dump({"bpm":120,"key":"Am","bars":barspec,"notes":notes,"chords":merged}, open("events.json","w"), indent=1)
