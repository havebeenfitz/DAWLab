# Sounds

| File | What | Source | Licence |
|---|---|---|---|
| `resources/sounds/rooster.mp3` | Notification sound "Rooster", played when a collaborator saves a version | Provided by the project owner (havebeenfitz) | Used with the owner's permission |

`rooster.mp3` is cut from the owner's `rooster_crowing.mp3`:

```bash
ffmpeg -ss 0.95 -t 1.9 -i rooster_crowing.mp3 \
  -af "afade=t=in:st=0:d=0.02,afade=t=out:st=1.82:d=0.08,loudnorm=I=-16:TP=-1:LRA=11" \
  -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k resources/sounds/rooster.mp3
```
