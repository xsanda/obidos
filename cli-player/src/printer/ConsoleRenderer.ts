import type { Board } from "@obidos/model/src/board/Board";
import { defaultCards } from "@obidos/model/src/game/DefaultGame";
import {
  fillArray,
  generateArray,
  outerWindow,
  range,
  repeatString,
} from "@obidos/model/src/iteration";
import type TileRenderer from "@obidos/model/src/printer/TileRenderer";
import { Side } from "@obidos/model/src/tile/Side";
import type { Tile } from "@obidos/model/src/tile/Tile";
import { TileRoad, TileRoadType } from "@obidos/model/src/tile/TileRoad";
import TileSide from "@obidos/model/src/tile/TileSide";
import { repeat, zip } from "wu";

export default class ConsoleRenderer implements TileRenderer<string[]> {
  private static coordinatesForSide: Record<Side, [number, number]> = Object.freeze({
    [Side.NORTH]: [-1, 0],
    [Side.EAST]: [0, 1],
    [Side.SOUTH]: [1, 0],
    [Side.WEST]: [0, -1],
  });

  private static distanceToSide(side: Side, y: number, x: number) {
    const [yy, xx] = this.coordinatesForSide[side];
    return Math.hypot(x - xx, y - yy);
  }

  constructor(readonly scale: number) {}

  private get midway() {
    return Math.floor((this.scale - 1) / 2);
  }

  private renderTileContents(tile: Tile): string[] {
    const scale = this.scale;

    const citySymbol = "🏠";
    const cloisterSymbol = "⛪";

    const canvas = generateArray(scale, () => fillArray(scale, "  "));

    function* eachCanvasCell(): Generator<
      [y: number, x: number, setter: (value: string) => void]
    > {
      for (const row of range(scale)) {
        const y = (row + 0.5) / scale - 0.5;
        for (const col of range(scale)) {
          const x = (col + 0.5) / scale - 0.5;

          const setter = (value: string) => {
            canvas[row][col] = value;
          };

          yield [y, x, setter];
        }
      }
    }

    const neighbours = (first: Side, other: Side) => {
      return (first + 1) % 4 === other || first === (other + 1) % 4;
    };

    for (const road of tile.roads) {
      const isStraight =
        road.type === TileRoadType.THROUGH && !neighbours(road.source, road.destination);
      const startFrom = isStraight ? this.midway : this.midway + 1;

      for (const roadSection of TileRoad.toSides(road)) {
        switch (roadSection) {
          case Side.NORTH:
            for (const row of range(0, this.midway)) {
              canvas[row][this.midway] = "││";
            }
            break;
          case Side.EAST:
            for (const col of range(startFrom, scale)) {
              canvas[this.midway][col] = "══";
            }
            break;
          case Side.SOUTH:
            for (const row of range(startFrom, scale)) {
              canvas[row][this.midway] = "││";
            }
            break;
          case Side.WEST:
            for (const col of range(0, this.midway)) {
              canvas[this.midway][col] = "══";
            }
            break;
        }
      }
    }

    if (tile.roads.length >= 3) {
      canvas[this.midway][this.midway] = "╳╳";
    }

    if (tile.cloister) {
      canvas[this.midway][this.midway] = cloisterSymbol;
    }

    for (const city of tile.cities) {
      const sides = [...city.walls];
      const missingSides = [Side.NORTH, Side.EAST, Side.SOUTH, Side.WEST].filter(
        (side) => !sides.includes(side),
      );
      if (sides.length === 1) {
        const [side] = sides;
        for (const [y, x, setter] of eachCanvasCell()) {
          if (ConsoleRenderer.distanceToSide(side, y, x) <= Math.sqrt(0.5)) {
            setter(citySymbol);
          }
        }
      } else if (sides.length === 2 && neighbours(sides[0], sides[1])) {
        for (const [y, x, setter] of eachCanvasCell()) {
          if (
            Math.min(...sides.map((side) => ConsoleRenderer.distanceToSide(side, y, x))) <
            Math.min(
              ...missingSides.map((side) => ConsoleRenderer.distanceToSide(side, y, x)),
            )
          ) {
            setter(citySymbol);
          }
        }
      } else {
        // city connects at least one pair of opposite sides
        for (const [y, x, setter] of eachCanvasCell()) {
          const distanceToMissingSide = Math.min(
            ...missingSides.map((side) => ConsoleRenderer.distanceToSide(side, y, x)),
          );
          if (distanceToMissingSide > Math.sqrt(0.5)) {
            setter(citySymbol);
          }
        }
      }
    }
    return canvas.map((row) => row.join(""));
  }

  private repeatStringWithMidway(edgeSymbol: string, midwaySymbol: string): string {
    return range(this.scale)
      .map((i) => (i === this.midway ? midwaySymbol : edgeSymbol))
      .toArray()
      .join("");
  }

  renderTile(tile: Tile, label = "┏"): string[] {
    const dashesForSide = (side: Side) =>
      this.repeatStringWithMidway("━━", tile.side(side) === TileSide.ROAD ? "┥┝" : "━━");
    const sideDash = (side: Side, i: number) =>
      i == this.midway && tile.side(side) === TileSide.ROAD ? "╪" : "┃";

    return [
      `${label}${dashesForSide(Side.NORTH)}┓`,
      ...this.renderTileContents(tile).map(
        (row, i) => `${sideDash(Side.WEST, i)}${row}${sideDash(Side.EAST, i)}`,
      ),
      `┗${dashesForSide(Side.SOUTH)}┛`,
    ];
  }

  static generateCorner(
    topLeft: boolean,
    topRight: boolean,
    bottomLeft: boolean,
    bottomRight: boolean,
  ): string {
    return " ┏┓┳┗┣╋╋┛╋┫╋┻╋╋╋".charAt(
      (bottomRight ? 1 : 0) +
        (bottomLeft ? 2 : 0) +
        (topRight ? 4 : 0) +
        (topLeft ? 8 : 0),
    );
  }

  renderBoard(board: Board): string[] {
    const { minCol, maxCol } = board;
    const grid = range(board.minRow, board.maxRow)
      .map((y) =>
        range(minCol, maxCol)
          .map((x) => board.get(y, x))
          .toArray(),
      )
      .toArray();

    const canvas: string[] = [];
    for (const [prevRow, currRow] of outerWindow(2)(grid)) {
      const newRows: string[][] = generateArray((currRow ? this.scale : 0) + 1, () => []);
      for (const [
        [aboveLeft, left] = repeat(undefined),
        [above, curr] = repeat(undefined),
      ] of outerWindow(2)(
        zip(prevRow ?? repeat(undefined), currRow ?? repeat(undefined)),
      )) {
        const leftWall = left || curr;
        const leftWallMidway =
          left?.side(Side.EAST) === TileSide.ROAD ||
          curr?.side(Side.WEST) === TileSide.ROAD;

        const aboveWall = above || curr;
        const aboveWallMidway =
          above?.side(Side.SOUTH) === TileSide.ROAD ||
          curr?.side(Side.NORTH) === TileSide.ROAD;

        const leftWallSymbol = leftWall ? "┃" : " ";
        const leftWallMidwaySymbol = leftWallMidway ? "╪" : leftWallSymbol;

        const aboveWallSymbol = aboveWall ? "━━" : "  ";
        const aboveWallMidwaySymbol = aboveWallMidway ? "┥┝" : aboveWallSymbol;

        const topLeftWallSymbol = ConsoleRenderer.generateCorner(
          aboveLeft !== undefined,
          above !== undefined,
          left !== undefined,
          curr !== undefined,
        );

        newRows[0].push(
          topLeftWallSymbol +
            this.repeatStringWithMidway(aboveWallSymbol, aboveWallMidwaySymbol),
        );
        const tileContents = curr && this.renderTileContents(curr);
        if (currRow) {
          for (const i of range(this.scale)) {
            newRows[i + 1].push(
              (i === this.midway ? leftWallMidwaySymbol : leftWallSymbol) +
                (tileContents?.[i] ?? repeatString(this.scale, "  ")),
            );
          }
        }
      }

      canvas.push(...newRows.map((row) => row.join("").trimEnd()));
    }
    return canvas;
  }

  printAllDefaultCards(): void {
    for (const [id, tile] of Object.entries(defaultCards)) {
      console.log(this.renderTile(tile, id).join("\n"));
    }
  }

  static main([, , scale]: string[]): void {
    const renderer = new ConsoleRenderer(+(scale || "9"));
    renderer.printAllDefaultCards();
  }
}

if (require.main === module) {
  ConsoleRenderer.main(process.argv);
}
