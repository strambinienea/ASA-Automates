(define (domain default)
    (:requirements :strips)
    (:predicates
        (on_tile ?tile)             ; true if agent is on tile
        (carrying ?parcel)          ; true if agent is carrying a parcel

        (above ?from_tile ?to_tile) ; true if to_tile is above from_tile
        (below ?from_tile ?to_tile) ; true if to_tile is below from_tile
        (left ?from_tile ?to_tile)  ; true if to_tile is left with respect to from_tile
        (right ?from_tile ?to_tile) ; true if to_tile is right with respect to from_tile
    )

    (:action mv_up
        :parameters (?from_tile ?to_tile)
        :precondition (and (on_tile ?from_tile) (not (on_tile ?to_tile)) (below ?from_tile ?to_tile))
        :effect (and (on_tile ?to_tile) (not (on_tile ?from_tile)))
    )
    (:action mv_down
        :parameters (?from_tile ?to_tile)
        :precondition (and (on_tile ?from_tile) (not (on_tile ?to_tile)) (above ?from_tile ?to_tile))
        :effect (and (on_tile ?to_tile) (not (on_tile ?from_tile)))
    )
    (:action mv_left
        :parameters (?from_tile ?to_tile)
        :precondition (and (on_tile ?from_tile) (not (on_tile ?to_tile)) (right ?from_tile ?to_tile))
        :effect (and (on_tile ?to_tile) (not (on_tile ?from_tile)))
    )
    (:action mv_right
        :parameters (?from_tile ?to_tile)
        :precondition (and (on_tile ?from_tile) (not (on_tile ?to_tile)) (left ?from_tile ?to_tile))
        :effect (and (on_tile ?to_tile) (not (on_tile ?from_tile)))
    )
)