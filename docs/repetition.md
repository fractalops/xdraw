# One declaration, many elements

A declaration may repeat. `each` names its instances by item; `count` names them
by position.

```xdraw
use "xdraw/palette" as palette

diagram "Ring" {
  let hub = 380
  let ring = 210

  spoke: ellipse "${each}" {
    each ("auth", "billing", "search", "audit", "email")
    at = (hub + ring * cos(tau * spoke.index / spoke.count), hub + ring * sin(tau * spoke.index / spoke.count))
    size (120, 72)
    style palette.info
  }
}
```

![Nine services in a computed ring, and eleven ticks stepped from their index](images/repetition.png)

Neither of those is writable by hand at any length: the position of each element
depends on which instance it is. Full source in
[`examples/repetition.xdraw`](../examples/repetition.xdraw).

## `each` names by item, `count` names by position

```
each ("Ingest", "Parse")   ->   stage.Ingest, stage.Parse
count 3                    ->   spoke.0, spoke.1, spoke.2
```

That difference is the reason both exist. A key describes identity and an index
describes position, so **inserting an item into an `each` leaves every other
instance named exactly as it was**:

```
each ("a", "c")        ->   s.a, s.c
each ("a", "b", "c")   ->   s.a, s.b, s.c        a and c keep their names
```

Inserting into a `count` renumbers everything after the insertion, and an edit
made in Excalidraw against `spoke.3` now belongs to a different element.
Terraform learned this the hard way with `count` and `for_each`; prefer `each`
whenever the instances have names worth using.

## What each instance knows

| | |
|---|---|
| `${each}` | the item, in a title or any other string |
| `name.index` | which instance this is, from 0 |
| `name.count` | how many there are |

`index` and `count` are what make repetition worth having, because they reach
expressions:

```xdraw
diagram "" {
  tick: rectangle "·" {
    count 11
    at = (880 + 62 * tick.index, 300 - 6 * tick.index)
    size (52, 90)
  }
}
```

`each.index` and `each.count` work too, if the declaration's own name is
awkward to repeat.

## Repeats may nest

A repeated declaration inside a container works, and its instances are named
under it, `panel.cell.0`. Children expand before their parent, so an inner
repeat's index is resolved before the outer one folds anything.

## What is rejected

```
's' uses both each and count; a declaration repeats one way or the other
's' each needs at least one item, written as ("a", "b")
's' each has a duplicate item 'a'
's' each item "two words" cannot be used as a name
's' count must be a whole number of at least 1
's' count is 100000, beyond the limit of 512
```

Two instances cannot share a name, so a duplicate item is refused rather than
silently collapsing to one element. The instance limit exists because a repeated
declaration is cheap to write and expensive to draw.

## Where it runs

[`src/language/repetition.ts`](../src/language/repetition.ts), before templates
expand: so a repeated declaration may use a template, and the instances are
ordinary declarations by the time anything else sees them.
