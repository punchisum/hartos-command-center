#!/usr/bin/env python3
"""
make_hartos_pdf.py — generates "hartos-for-you.pdf"

A cute, non-technical little booklet that explains what HartOS is,
what it can do, and why it was built — written warmly and addressed
directly to someone the author loves. Pure-vector (no external assets),
rendered with reportlab so it builds anywhere.
"""

import math
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color

W, H = A4

# ---- palette -------------------------------------------------------------
CREAM    = Color(1.000, 0.969, 0.941)   # warm paper
CREAM2   = Color(0.996, 0.945, 0.905)
INK      = Color(0.227, 0.180, 0.165)   # soft dark brown (text)
INK_SOFT = Color(0.43,  0.36,  0.34)
CORAL    = Color(1.000, 0.494, 0.420)
PEACH    = Color(1.000, 0.847, 0.761)
SAGE     = Color(0.612, 0.769, 0.651)
BLUE     = Color(0.561, 0.702, 0.851)
BUTTER   = Color(1.000, 0.906, 0.659)
PINK     = Color(0.984, 0.776, 0.831)
HEART    = Color(1.000, 0.420, 0.506)
WHITE    = Color(1, 1, 1)


# ---- little drawing helpers ---------------------------------------------
def heart(c, cx, cy, s, color, alpha=1.0):
    """Draw a filled heart centred-ish at (cx, cy), scale s."""
    c.saveState()
    c.setFillColor(color)
    if alpha < 1.0:
        c.setFillAlpha(alpha)
    p = c.beginPath()
    # parametric heart, scaled
    pts = []
    steps = 60
    for i in range(steps + 1):
        t = math.pi * 2 * i / steps
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * s / 16.0, cy + y * s / 16.0))
    p.moveTo(*pts[0])
    for pt in pts[1:]:
        p.lineTo(*pt)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


def panel(c, x, y, w, h, r, fill, stroke=None, sw=0):
    c.saveState()
    c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(sw)
        c.roundRect(x, y, w, h, r, fill=1, stroke=1)
    else:
        c.roundRect(x, y, w, h, r, fill=1, stroke=0)
    c.restoreState()


def bg(c, color=CREAM):
    c.setFillColor(color)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def dot(c, x, y, r, color, alpha=1.0):
    c.saveState()
    c.setFillColor(color)
    if alpha < 1.0:
        c.setFillAlpha(alpha)
    c.circle(x, y, r, fill=1, stroke=0)
    c.restoreState()


def wrap(c, text, x, y, width, font, size, leading, color, align="left"):
    """Very small word-wrapper. Returns the y after the last line."""
    c.setFont(font, size)
    c.setFillColor(color)
    words = text.split()
    line = ""
    for w_ in words:
        test = (line + " " + w_).strip()
        if c.stringWidth(test, font, size) <= width:
            line = test
        else:
            _put(c, line, x, y, width, align, font, size)
            y -= leading
            line = w_
    if line:
        _put(c, line, x, y, width, align, font, size)
        y -= leading
    return y


def _put(c, line, x, y, width, align, font, size):
    if align == "center":
        c.drawCentredString(x + width / 2, y, line)
    elif align == "right":
        c.drawRightString(x + width, y, line)
    else:
        c.drawString(x, y, line)


def scatter_hearts(c, seed_pts):
    for (x, y, s, col, a) in seed_pts:
        heart(c, x, y, s, col, a)


# ---- icons for the feature cards ----------------------------------------
def icon_eye(c, cx, cy, col):
    c.saveState()
    c.setStrokeColor(col)
    c.setLineWidth(2.4)
    c.setLineCap(1)
    # eye outline (two arcs)
    p = c.beginPath()
    p.moveTo(cx - 9, cy)
    p.curveTo(cx - 4, cy + 7, cx + 4, cy + 7, cx + 9, cy)
    p.curveTo(cx + 4, cy - 7, cx - 4, cy - 7, cx - 9, cy)
    c.drawPath(p, fill=0, stroke=1)
    c.setFillColor(col)
    c.circle(cx, cy, 2.6, fill=1, stroke=0)
    c.restoreState()


def icon_brain(c, cx, cy, col):
    c.saveState()
    c.setStrokeColor(col)
    c.setLineWidth(2.2)
    c.setLineCap(1)
    c.circle(cx - 3, cy + 2, 5.5, fill=0, stroke=1)
    c.circle(cx + 4, cy - 1, 5.0, fill=0, stroke=1)
    c.circle(cx - 1, cy - 4, 4.2, fill=0, stroke=1)
    c.restoreState()


def icon_hand(c, cx, cy, col):
    # a gentle "stop / ask first" palm
    c.saveState()
    c.setStrokeColor(col)
    c.setFillColor(col)
    c.setLineWidth(2.2)
    c.roundRect(cx - 6, cy - 8, 12, 13, 4, fill=0, stroke=1)
    for i in range(4):
        x = cx - 5 + i * 3.4
        c.line(x, cy + 5, x, cy + 9)
    c.restoreState()


def icon_speech(c, cx, cy, col):
    c.saveState()
    c.setStrokeColor(col)
    c.setLineWidth(2.2)
    c.setLineJoin(1)
    c.roundRect(cx - 9, cy - 4, 18, 12, 4, fill=0, stroke=1)
    p = c.beginPath()
    p.moveTo(cx - 4, cy - 4)
    p.lineTo(cx - 6, cy - 9)
    p.lineTo(cx + 0, cy - 4)
    c.drawPath(p, fill=0, stroke=1)
    c.restoreState()


def icon_bolt(c, cx, cy, col):
    c.saveState()
    c.setFillColor(col)
    p = c.beginPath()
    p.moveTo(cx + 2, cy + 9)
    p.lineTo(cx - 6, cy - 1)
    p.lineTo(cx - 1, cy - 1)
    p.lineTo(cx - 3, cy - 9)
    p.lineTo(cx + 6, cy + 2)
    p.lineTo(cx + 1, cy + 2)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.restoreState()


SERIF      = "Times-Roman"
SERIF_IT   = "Times-Italic"
SERIF_B    = "Times-Bold"
SANS       = "Helvetica"
SANS_B     = "Helvetica-Bold"


# =========================================================================
#  PAGE 1 — COVER
# =========================================================================
def cover(c):
    bg(c)
    # soft confetti of hearts
    scatter_hearts(c, [
        (70, 760, 22, PEACH, 0.9), (520, 790, 16, PINK, 0.8),
        (480, 700, 12, BUTTER, 0.9), (95, 640, 13, SAGE, 0.7),
        (300, 815, 10, CORAL, 0.6), (540, 560, 14, BLUE, 0.6),
        (60, 470, 11, PINK, 0.6), (525, 300, 18, PEACH, 0.8),
        (80, 250, 14, BUTTER, 0.8), (470, 150, 12, SAGE, 0.7),
        (300, 120, 10, PINK, 0.6), (120, 120, 9, CORAL, 0.5),
    ])

    # big central heart with the name
    heart(c, W / 2, 540, 230, HEART, 1.0)
    heart(c, W / 2, 552, 196, CORAL, 1.0)

    c.setFillColor(WHITE)
    c.setFont(SANS_B, 52)
    c.drawCentredString(W / 2, 520, "HartOS")
    c.setFont(SERIF_IT, 16)
    c.drawCentredString(W / 2, 492, "the little thing I built")

    # title block
    c.setFillColor(INK)
    c.setFont(SERIF_B, 30)
    c.drawCentredString(W / 2, 330, "A tiny guide to my")
    c.drawCentredString(W / 2, 296, "command center")
    c.setFont(SERIF_IT, 17)
    c.setFillColor(INK_SOFT)
    c.drawCentredString(W / 2, 258, "what it does, and why I made it")

    # for-you ribbon
    panel(c, W / 2 - 110, 175, 220, 40, 20, WHITE, stroke=CORAL, sw=1.5)
    c.setFillColor(CORAL)
    c.setFont(SANS_B, 13)
    c.drawCentredString(W / 2, 188, "made with love, for you")
    heart(c, W / 2 - 92, 195, 12, HEART)
    heart(c, W / 2 + 92, 195, 12, HEART)

    c.showPage()


# =========================================================================
#  PAGE 2 — HEY YOU (intro letter)
# =========================================================================
def page_intro(c):
    bg(c)
    scatter_hearts(c, [
        (520, 790, 16, PEACH, 0.8), (430, 795, 11, PINK, 0.6),
        (540, 120, 14, BUTTER, 0.7), (60, 110, 12, SAGE, 0.6),
    ])

    c.setFillColor(CORAL)
    c.setFont(SANS_B, 34)
    c.drawString(64, 740, "hey, you")
    heart(c, 250, 752, 20, HEART)

    panel(c, 56, 350, W - 112, 340, 26, WHITE, stroke=PEACH, sw=1.2)

    y = 640
    lines = [
        ("You've probably seen me up late, glued to my laptop, "
         "grinning at a dark screen full of tiny glowing numbers, "
         "muttering words like \"agents\" and \"proposals.\""),
        ("I realised I've never actually explained what that whole "
         "thing is. So here it is — the honest version, no confusing "
         "tech talk, I promise. Just me, telling you about the thing "
         "I built."),
        ("Its name is HartOS. Think of it less like an app and more "
         "like a quiet little room in the back of my mind that I "
         "finally got to build on the outside."),
        ("Turn the page and I'll show you around."),
    ]
    for i, t in enumerate(lines):
        font = SERIF_IT if i == len(lines) - 1 else SERIF
        y = wrap(c, t, 88, y, W - 176, font, 15.5, 23, INK)
        y -= 14

    c.showPage()


# =========================================================================
#  PAGE 3 — SO... WHAT IS IT?
# =========================================================================
def page_what(c):
    bg(c)
    scatter_hearts(c, [
        (430, 795, 13, BUTTER, 0.8), (530, 770, 13, PINK, 0.7),
        (90, 150, 13, SAGE, 0.6), (520, 130, 12, PEACH, 0.6),
    ])

    c.setFillColor(INK)
    c.setFont(SANS_B, 30)
    c.drawString(64, 760, "so... what is it?")

    # the simple metaphor card
    panel(c, 56, 470, W - 112, 250, 26, BLUE)
    c.setFillColor(WHITE)
    y = wrap(c,
        "HartOS is basically a second brain I built for myself.",
        88, 678, W - 176, SANS_B, 18, 26, WHITE)
    y -= 8
    y = wrap(c,
        "Picture a calm little control room — like the ones at NASA "
        "mission control, but cozier, and just for one person. Me.",
        88, y, W - 176, SERIF, 15.5, 23, WHITE)
    y -= 10
    wrap(c,
        "It quietly keeps an eye on all the moving parts of my life "
        "and work, and holds them in one place so I don't have to "
        "carry every little thing around in my head.",
        88, y, W - 176, SERIF, 15.5, 23, WHITE)

    # gentle one-liner below
    heart(c, 80, 412, 16, HEART)
    wrap(c,
        "It doesn't nag. It doesn't show off. It just watches, "
        "remembers, and gently raises its hand when something "
        "actually needs me.",
        104, 420, W - 200, SERIF_IT, 16, 24, INK)

    # three soft chips
    chips = [("watches", SAGE), ("remembers", PINK), ("asks first", BUTTER)]
    cx = 70
    for label, col in chips:
        wlab = c.stringWidth(label, SANS_B, 13) + 40
        panel(c, cx, 300, wlab, 38, 19, col)
        c.setFillColor(INK)
        c.setFont(SANS_B, 13)
        c.drawCentredString(cx + wlab / 2, 312, label)
        cx += wlab + 16

    c.showPage()


# =========================================================================
#  PAGE 4 — WHAT IT CAN DO (feature cards)
# =========================================================================
def page_features(c):
    bg(c)
    c.setFillColor(INK)
    c.setFont(SANS_B, 30)
    c.drawString(64, 770, "what it can actually do")

    cards = [
        (icon_eye,    SAGE,  "It watches everything",
         "It keeps an eye on all my projects and to-dos across every "
         "app I use, so nothing important quietly slips through the "
         "cracks."),
        (icon_brain,  BLUE,  "It remembers",
         "It keeps a little memory of what happened, what worked, and "
         "what I keep forgetting — so I stop making the same mistakes "
         "twice."),
        (icon_hand,   CORAL, "It NEVER acts without asking",
         "This is the big one. It can suggest things, but it can never "
         "actually do anything until I say yes. I'm always the one in "
         "charge — never the machine."),
        (icon_speech, PINK,  "It tells the truth",
         "If it doesn't know something, it simply says \"I don't know\" "
         "instead of pretending. No fake confidence. Honesty over "
         "showing off."),
        (icon_bolt,   BUTTER,"It's fast",
         "One glance and I know how my whole day is doing. Ten seconds, "
         "then I get to put it down and get back to real life."),
    ]

    top = 712
    ch = 116
    gap = 14
    x = 56
    cw = W - 112
    for icon, col, title, body in cards:
        y = top - ch
        panel(c, x, y, cw, ch, 22, WHITE, stroke=PEACH, sw=1.0)
        # icon badge
        dot(c, x + 46, y + ch / 2, 26, col)
        c.setFillColor(WHITE)
        icon(c, x + 46, y + ch / 2, WHITE)
        # text
        tx = x + 92
        c.setFillColor(INK)
        c.setFont(SANS_B, 15.5)
        c.drawString(tx, y + ch - 32, title)
        wrap(c, body, tx, y + ch - 54, cw - (tx - x) - 26, SERIF, 13, 18, INK_SOFT)
        top = y - gap

    c.showPage()


# =========================================================================
#  PAGE 5 — WHY I MADE IT (the heart of it)
# =========================================================================
def page_why(c):
    bg(c, CREAM2)
    scatter_hearts(c, [
        (520, 800, 18, HEART, 0.85), (440, 795, 11, CORAL, 0.6),
        (540, 130, 14, PINK, 0.7), (60, 120, 12, PEACH, 0.7),
    ])

    c.setFillColor(HEART)
    c.setFont(SANS_B, 32)
    c.drawString(64, 760, "why I made it")
    heart(c, 320, 772, 20, HEART)

    panel(c, 56, 310, W - 112, 410, 26, WHITE, stroke=PINK, sw=1.2)

    y = 672
    paras = [
        ("Honestly? Because my brain gets full.", SERIF_B, 17, 25),
        ("I care about a lot of things — my work, my goals, the "
         "people I love. And I was tired of carrying every tiny "
         "detail around in my head, always a little afraid of "
         "dropping something that mattered.", SERIF, 15.5, 23),
        ("I didn't want another loud app that buzzes and begs for "
         "attention. I wanted something calm and honest that could "
         "hold the boring stuff for me — so I'd have more room left "
         "over for the things that actually matter.", SERIF, 15.5, 23),
        ("Like being present. Like slowing down. Like you.",
         SERIF_IT, 16.5, 24),
        ("It was never about a machine taking over my life. It's "
         "about freeing me up to actually be in it — more here, "
         "more often, with you.", SERIF, 15.5, 23),
    ]
    for t, font, size, lead in paras:
        col = HEART if font == SERIF_IT else INK
        y = wrap(c, t, 88, y, W - 176, font, size, lead, col)
        y -= 16

    c.showPage()


# =========================================================================
#  PAGE 6 — CLOSING
# =========================================================================
def page_closing(c):
    bg(c)
    scatter_hearts(c, [
        (90, 740, 16, PEACH, 0.8), (500, 760, 13, BUTTER, 0.7),
        (520, 250, 15, PINK, 0.7), (80, 230, 12, SAGE, 0.6),
    ])

    heart(c, W / 2, 600, 150, HEART)
    heart(c, W / 2, 610, 124, CORAL)
    c.setFillColor(WHITE)
    c.setFont(SANS_B, 22)
    c.drawCentredString(W / 2, 590, "that's it")

    y = 470
    y = wrap(c,
        "So that's HartOS.",
        96, y, W - 192, SERIF_B, 18, 26, INK, align="center")
    y -= 10
    y = wrap(c,
        "Not a robot running my life — just a quiet little helper "
        "that lets me set my life down for a second and breathe.",
        96, y, W - 192, SERIF, 15.5, 24, INK, align="center")
    y -= 16
    y = wrap(c,
        "Thank you for wanting to understand it. "
        "That honestly means more to me than you know.",
        96, y, W - 192, SERIF_IT, 16, 24, INK_SOFT, align="center")

    # signature
    c.setFillColor(CORAL)
    c.setFont(SANS_B, 18)
    c.drawCentredString(W / 2, 250, "— yours, the one who built it")
    heart(c, W / 2, 215, 22, HEART)

    c.showPage()


def build(path):
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle("HartOS — a little guide, for you")
    c.setAuthor("Hart")
    cover(c)
    page_intro(c)
    page_what(c)
    page_features(c)
    page_why(c)
    page_closing(c)
    c.save()


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "hartos-for-you.pdf"
    build(out)
    print("wrote", out)
