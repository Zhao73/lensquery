# Undisclosed watermark discovery lab

This lab searches for a repeatable fixed spatial residual across multiple media files. It requires an ordinary negative-control group and uses a permutation null; optionally it also requires a matching re-encoded set. It never calls a candidate an AI-origin proof.

Requirements:

```bash
python3 -m pip install numpy opencv-python
brew install ffmpeg
```

Example:

```bash
python3 scripts/research/undisclosed-watermark-lab.py \
  --group 'provider-a=/path/provider-a/*.mp4' \
  --group 'ordinary-control=/path/controls/*.mp4' \
  --reencoded 'provider-a=/path/reencoded/provider-a-*-crf28.mp4' \
  --output /tmp/watermark-lab
```

Use at least four diverse files per group. Keep acquisition provenance and hashes. A candidate still requires independent attribution to a decoder, key, public specification, or issuer verifier; shared intros, logos, borders, and codec pipelines are confounds.
