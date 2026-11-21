# PDF font

`NotoSansSC-subset.ttf` is a subset of Noto Sans SC (Source Han Sans,
© 2014-2021 Adobe) covering ASCII, Latin-1, general punctuation, CJK
punctuation, the fullwidth forms, and the GB 2312 character set. It is the
font embedded in questionnaire and report PDFs so Chinese renders on every
platform without a system font lookup.

Regenerate with fontTools:

```bash
pyftsubset NotoSansSC.ttf --text-file=gb2312-chars.txt \
  --output-file=NotoSansSC-subset.ttf --layout-features='*' --no-hinting
```

`LICENSE-OFL.txt` is the SIL Open Font License 1.1 the font is distributed
under.
