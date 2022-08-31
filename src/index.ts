/****************************************************************************
 *
 * @file constants
 *
 ****************************************************************************/

const WALL_THICKNESS = 1 / 4;
const DETAIL = 1; // make this bigger to get more curve
const MAZE_SIDE = 41; // must be odd
const END_HALLWAY_LENGTH = 6;

const HALF = MAZE_SIDE >> 1;

type Camera = {
	x: number;
	y: number;
};

let camera: Camera = { x: 0.5, y: 0.5 };

/****************************************************************************
 *
 * @file raii
 *
 * RAII is a useful concept from C++.
 *
 * The important idea is that things get cleaned up when they go out-of-scope.
 *
 ****************************************************************************/

/**
 * Work that we need to run when we are finished using the active resource.
 *
 * This is a stack, so the code will be called in reverse-order, though that
 * should not really be used.
 */
type CleanupStack = (() => void)[];

/**
 * Associates objects with the code we need to run on "cleanup" of those
 * objects. We use a standard Map here instead of a WeakMap because these
 * objects must be cleaned.
 */
const ACTIVE_RESOURCES: Map<unknown, CleanupStack> = new Map();

/**
 * This is defined if we are in a `runAndCleanOnError` call. It is an array of
 * code to call when cleaning up
 */
let activeCleanupStack: null | CleanupStack = null;

/**
 * Runs code that we are worried might throw an exception. If it does, then
 * the registered clean-up functions will be called (they are registered by
 * calling the `ifError` function)
 */
function runAndCleanOnError<T>(code: () => T): T {
	return _runAndCleanOnError(code)[0];
}

function allocate<T>(code: () => T): T {
	const [resource, cleanupStack] = _runAndCleanOnError(code);

	// will there ever be a prior, seems like a mistake?
	const prior = ACTIVE_RESOURCES.get(resource);

	if (prior) {
		prior.push(...cleanupStack);
	} else {
		ACTIVE_RESOURCES.set(resource, cleanupStack);

		// automatically cleanup if the parent is cleaning
		activeCleanupStack?.push(() => {
			release(resource);
		});
	}

	return resource;
}

function release(resource: Object) {
	const cleanupStack = ACTIVE_RESOURCES.get(resource);

	if (cleanupStack) {
		ACTIVE_RESOURCES.delete(resource);
		runCleanup(cleanupStack);
	} else {
		console.warn(`unrecognized release`, resource);
	}
}

function onRelease(cleanup: () => void) {
	if (activeCleanupStack) {
		activeCleanupStack.push(cleanup);
	} else {
		throw new Error(`onRelease called outside of allocation`);
	}
}

function _runAndCleanOnError<T>(code: () => T): [T, CleanupStack] {
	const parentStack = activeCleanupStack;
	const cleanupStack: CleanupStack = [];
	activeCleanupStack = cleanupStack;

	let success = false;
	try {
		const result = code();
		success = true;
		return [result, cleanupStack];
	} finally {
		// using a finally block to avoid re-throwing the error (which I think,
		// but have not verified, will mess with the stack)

		activeCleanupStack = parentStack;

		if (!success) runCleanup(cleanupStack);
	}
}

/**
 * Calls everything in the stack, will output any thrown exceptions to the
 * console.
 */
function runCleanup(cleanupCode: CleanupStack) {
	let i = cleanupCode.length;
	while (i--) {
		const clean = cleanupCode[i];
		try {
			clean();
		} catch (error) {
			console.error(error);
		}
	}
}

/****************************************************************************
 *
 * @file webgl
 *
 ****************************************************************************/

function SHADER(
	gl: WebGLRenderingContext,
	vertexShader: boolean
): (code: TemplateStringsArray, ...args: unknown[]) => WebGLShader {
	return (codeParts, ...args) =>
		allocate(() => {
			const shaderEnum = vertexShader ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;

			const glShader =
				gl.createShader(shaderEnum) || E(1001)`Failed to create shader`;

			onRelease(() => void gl.deleteShader(glShader));

			gl.shaderSource(glShader, plainLiteral(codeParts, args));
			gl.compileShader(glShader);

			gl.getShaderParameter(glShader, gl.COMPILE_STATUS) ||
				E(1002)`Failed to compile shader: ${gl.getShaderInfoLog(glShader)}`;

			return glShader;
		});
}

function PROGRAM(
	gl: WebGLRenderingContext,
	vertexShader: WebGLShader,
	fragmentShader: WebGLShader
): WebGLProgram {
	return allocate(() => {
		const glProgram: WebGLProgram =
			gl.createProgram() || E(1004)`Failed to create program`;

		gl.attachShader(glProgram, vertexShader);
		gl.attachShader(glProgram, fragmentShader);
		onRelease(() => {
			gl.detachShader(glProgram, fragmentShader);
			gl.detachShader(glProgram, vertexShader);
		});

		return glProgram;
	});
}

function link(gl: WebGLRenderingContext, glProgram: WebGLProgram) {
	gl.linkProgram(glProgram);
	gl.getProgramParameter(glProgram, gl.LINK_STATUS) ||
		E(1003)`Program did not link: ${gl.getProgramInfoLog(glProgram)}`;
}

/****************************************************************************
 *
 * @file utils
 *
 ****************************************************************************/

function DEBUG(code: () => void) {
	// comment out in minified builds
	code();
}

function E(
	errorCode: number
): (parts: TemplateStringsArray, ...args: unknown[]) => any {
	// in minified builds, throw error code
	throw new Error(`Code ${errorCode}`);

	// in dev builds
	// return (parts, ...args) => {
	// 	const error = new Error(plainLiteral(parts, args));
	// 	error.name = `E(${errorCode})`;
	// 	throw error;
	// };
}

function plainLiteral(parts: TemplateStringsArray, args: unknown[]): string {
	const length = args.length;
	if (!length) return parts[0];

	const text: unknown[] = [parts[0]];
	for (let i = 0; i < args.length; i++) {
		text.push(args[i], parts[i + 1]);
	}
	return text.join("");
}

// taken from https://stackoverflow.com/a/70219726
// prettier-ignore
const CUBE = new Float32Array([
  +0.5, +0.5, -0.5, // Back-top-right
  -0.5, +0.5, -0.5, // Back-top-left
  +0.5, -0.5, -0.5, // Back-bottom-right
  -0.5, -0.5, -0.5, // Back-bottom-left
  -0.5, -0.5, +0.5, // Front-bottom-left
  -0.5, +0.5, -0.5, // Back-top-left
  -0.5, +0.5, +0.5, // Front-top-left
  +0.5, +0.5, -0.5, // Back-top-right
  +0.5, +0.5, +0.5, // Front-top-right
  +0.5, -0.5, -0.5, // Back-bottom-right
  +0.5, -0.5, +0.5, // Front-bottom-right
  -0.5, -0.5, +0.5, // Front-bottom-left
  +0.5, +0.5, +0.5, // Front-top-right
  -0.5, +0.5, +0.5, // Front-top-left
]);

// prettier-ignore
const IDENTITY = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1,
]);

function shuffledForEach<T>(
	array: T[],
	code: (element: T, index: number) => unknown
) {
	const indices = array.map((_, i) => i);
	const rand = array.map(() => Math.random());
	indices.sort((a, b) => rand[a] - rand[b]);
	indices.forEach((originalIndex, i) => code(array[originalIndex], i));
}

/****************************************************************************
 *
 * @file game geometry
 *
 ****************************************************************************/

type EntityRange = {
	offset: number;
	length: number;
};

type Block = EntityRange[];

type WallBlocks = {
	south: Block;
	west: Block;
	column: Block;
	rawData: Float32Array;
};

function makeWallBlocks() {
	const STEP = WALL_THICKNESS / DETAIL;

	const points: number[] = [];
	let index = 0;

	const vertex = (x: number, y: number, z: number) => {
		index++;
		points.push(x, y, z, ...normal);
	};

	const column: Block = [];
	const south: Block = [];
	const west: Block = [];

	let surfaceStartIndex = 0;
	const finishSurface = (block: Block) => {
		// push the wall-face into the wall
		block.push({
			offset: surfaceStartIndex,
			length: index - surfaceStartIndex,
		});

		// restart the surface
		surfaceStartIndex = index;
	};

	// assumes that we built the full wall and we chop off WALL_THICKNESS
	// percent for the column
	const portionColumn = () => {
		const length = 2 + (index - surfaceStartIndex - 2) * WALL_THICKNESS;

		column.push({ offset: surfaceStartIndex, length });

		// subtract 2 because they share two points
		surfaceStartIndex += length - 2;
	};

	let normal: number[] = [0, -1, 0];

	// the front south wall
	for (let x = 0; x <= 1; x += STEP) {
		vertex(x, 0, 1);
		vertex(x, 0, 0);
	}
	portionColumn();
	finishSurface(south);

	// the back of the south wall
	normal = [0, 1, 0];
	for (let x = 0; x <= 1; x += STEP) {
		vertex(x, WALL_THICKNESS, 0);
		vertex(x, WALL_THICKNESS, 1);
	}
	portionColumn();
	finishSurface(south);

	// the back of the west wall
	normal = [0, 1, 0];
	for (let x = 0; x <= WALL_THICKNESS; x += STEP) {
		vertex(x, 1, 0);
		vertex(x, 1, 1);
	}
	finishSurface(west);

	// the top of the south wall
	// (this does not work with the DETAIL stuff)
	normal = [0, 0, 1];
	for (let x = 0; x <= 1; x += STEP) {
		vertex(x, WALL_THICKNESS, 1);
		vertex(x, 0, 1);
	}
	portionColumn();
	finishSurface(south);

	// the top of the west wall
	for (let y = WALL_THICKNESS; y <= 1; y += STEP) {
		vertex(0, y, 1);
		vertex(WALL_THICKNESS, y, 1);
	}
	finishSurface(west);

	// the right of the south wall
	normal = [1, 0, 0];
	for (let y = 0; y <= WALL_THICKNESS; y += STEP) {
		vertex(1, y, 1);
		vertex(1, y, 0);
	}
	finishSurface(south);

	// the right of the west wall
	for (let y = 0; y <= 1; y += STEP) {
		vertex(WALL_THICKNESS, y, 1);
		vertex(WALL_THICKNESS, y, 0);
	}
	portionColumn();
	finishSurface(west);

	// the left of the west wall
	normal = [-1, 0, 0];
	for (let y = 0; y <= 1; y += STEP) {
		vertex(0, y, 0);
		vertex(0, y, 1);
	}
	portionColumn();
	finishSurface(west);

	return {
		south,
		west,
		column,
		rawData: new Float32Array(points),
	};
}

/****************************************************************************
 *
 * @file matrices
 *
 ****************************************************************************/

// always 4x4
type Matrix = Float32Array;

function mult(A: Matrix, B: Matrix): Matrix {
	// Multiply A and B... beautiful...
	const matrix = new Float32Array([
		A[0] * B[0] + A[1] * B[4] + A[2] * B[8] + A[3] * B[12],
		A[0] * B[1] + A[1] * B[5] + A[2] * B[9] + A[3] * B[13],
		A[0] * B[2] + A[1] * B[6] + A[2] * B[10] + A[3] * B[14],
		A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3] * B[15],
		A[4] * B[0] + A[5] * B[4] + A[6] * B[8] + A[7] * B[12],
		A[4] * B[1] + A[5] * B[5] + A[6] * B[9] + A[7] * B[13],
		A[4] * B[2] + A[5] * B[6] + A[6] * B[10] + A[7] * B[14],
		A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7] * B[15],
		A[8] * B[0] + A[9] * B[4] + A[10] * B[8] + A[11] * B[12],
		A[8] * B[1] + A[9] * B[5] + A[10] * B[9] + A[11] * B[13],
		A[8] * B[2] + A[9] * B[6] + A[10] * B[10] + A[11] * B[14],
		A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11] * B[15],
		A[12] * B[0] + A[13] * B[4] + A[14] * B[8] + A[15] * B[12],
		A[12] * B[1] + A[13] * B[5] + A[14] * B[9] + A[15] * B[13],
		A[12] * B[2] + A[13] * B[6] + A[14] * B[10] + A[15] * B[14],
		A[12] * B[3] + A[13] * B[7] + A[14] * B[11] + A[15] * B[15],
	]);

	return matrix;
}

/****************************************************************************
 *
 * @file maze generation
 *
 ****************************************************************************/

const BLOCKS_WEST = 1 << 0;
const BLOCKS_SOUTH = 1 << 1;

type Maze = number[];

function makeMaze(): Maze {
	const unionFind: number[] = [];
	for (let i = 0; i < MAZE_SIDE * MAZE_SIDE; i++) {
		unionFind.push(-1);
	}

	// connection will be the index concatenated onto a bool for checking west
	const connectionsToCheck: number[] = [];

	unionFind.forEach((_, i) => {
		connectionsToCheck.push(i << 1);

		const x = i % MAZE_SIDE;

		// if we are not in the final hallway, also consider opening the west wall
		if (
			!((x === HALF || x === HALF + 1) && i < END_HALLWAY_LENGTH * MAZE_SIDE)
		) {
			connectionsToCheck.push((i << 1) | 1);
		}
	});

	const maze: number[] = unionFind.map(() => 3);

	const rootOf = (index: number): number => {
		const parent = unionFind[index];
		if (parent < 0) {
			return index;
		} else {
			return (unionFind[index] = rootOf(parent));
		}
	};

	const unionIfDisconnected = (aIndex: number, bIndex: number) => {
		const a = rootOf(aIndex);
		const b = rootOf(bIndex);

		// if they have the same root, nothing to do
		if (a === b) return false;

		const aNegSize = unionFind[a];
		const bNegSize = unionFind[b];

		if (aNegSize < bNegSize) {
			unionFind[a] = aNegSize + bNegSize;
			unionFind[b] = a;
		} else {
			unionFind[a] = b;
			unionFind[b] = aNegSize + bNegSize;
		}

		return true;
	};

	// open a hallway/gate at the bottom
	maze[HALF] &= 1;

	shuffledForEach(connectionsToCheck, (connection) => {
		const index = connection >> 1;

		if (connection & 1) {
			// test if we connect to the block to the left, but do nothing if we are
			// are the left-most
			const isLeftmost = !(index % MAZE_SIDE);
			if (!isLeftmost && unionIfDisconnected(index, index - 1)) {
				// subtracts out the left-facing bit
				maze[index] &= ~BLOCKS_WEST;
			}
		} else {
			const isBottom = index < MAZE_SIDE;
			if (!isBottom && unionIfDisconnected(index, index - MAZE_SIDE)) {
				// subtracts out the bottom-facing bit
				maze[index] &= ~BLOCKS_SOUTH;
			}
		}
	});

	return maze;
}

/****************************************************************************
 *
 * @file rendering
 *
 ****************************************************************************/

type WebGLAttribute = number;

type RenderInfo = {
	gl: WebGLRenderingContext;
	dim: { width: number; height: number };
	wallProgram: WebGLProgram;
	wallBlocks: WallBlocks;
	wallBlockBuffer: WebGLBuffer;
	attribute: {
		normal: WebGLAttribute;
		position: WebGLAttribute;
	};
	uniform: {
		majorPosition: WebGLUniformLocation;
		projection: WebGLUniformLocation;
	};
};

type GameInfo = {
	maze: Maze;
	renderInfo: RenderInfo;
};

function render(info: GameInfo) {
	const {
		maze,
		renderInfo: { gl, dim, wallProgram, wallBlocks, attribute, uniform },
	} = info;

	gl.useProgram(wallProgram);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.CULL_FACE);

	gl.enableVertexAttribArray(attribute.position);
	gl.vertexAttribPointer(attribute.position, 3, gl.FLOAT, false, 24, 0);

	gl.enableVertexAttribArray(attribute.normal);
	gl.vertexAttribPointer(attribute.normal, 3, gl.FLOAT, false, 24, 12);

	/*
	const pxPerBlock = Math.floor(
		(0.875 * Math.min(dim.width, dim.height)) / MAZE_SIDE
	);

	const xScale = (2 * pxPerBlock) / dim.width;
	const yScale = (2 * pxPerBlock) / dim.height;

	// prettier-ignore
	const cameraMatrix = new Float32Array([
		xScale, 0, +0.0, +0.0,
		0, yScale, 1 / 32, +0.0,
		0, yScale / 2, +0.0, +0.0,
		-(camera.x * xScale), -(camera.y * yScale), +0.0, +1.0,
	]);
	*/

	// prettier-ignore
	const cameraMatrix = new Float32Array([
		1/2, 0, +0.0, +0.0,
		0, 0, 1 / MAZE_SIDE, 1,
		0, 1, +0.0, +0.0,
		camera.x, -.6, -camera.y / MAZE_SIDE, 0,
	]);

	gl.uniformMatrix4fv(uniform.projection, false, cameraMatrix);

	const drawBlock = (block: Block) => {
		block.forEach((surface) => {
			gl.drawArrays(gl.TRIANGLE_STRIP, surface.offset, surface.length);
		});
	};

	// draw the maze
	maze.forEach((connections, index) => {
		const x = index % MAZE_SIDE;
		const y = Math.floor(index / MAZE_SIDE);

		gl.uniform3f(uniform.majorPosition, x - HALF, y - HALF, 0);

		connections & 1 && drawBlock(wallBlocks.west);
		drawBlock(wallBlocks.column);
		connections & 2 && drawBlock(wallBlocks.south);
	});

	// draw the north and east walls
	for (let d = -HALF; d <= HALF; d++) {
		gl.uniform3f(uniform.majorPosition, d, HALF + 1, 0);
		drawBlock(wallBlocks.south);
		drawBlock(wallBlocks.column);

		gl.uniform3f(uniform.majorPosition, HALF + 1, d, 0);
		drawBlock(wallBlocks.west);
		drawBlock(wallBlocks.column);
	}

	gl.uniform3f(uniform.majorPosition, HALF + 1, HALF + 1, 0);
	drawBlock(wallBlocks.column);
}

/****************************************************************************
 *
 * @file exe
 *
 ****************************************************************************/

function onWindowEvent(event: string, handler: (e: unknown) => void) {
	window.addEventListener(event, handler);
}

function run() {
	const canvas = document.createElement("canvas");

	const width = window.innerWidth;
	const height = window.innerHeight;
	canvas.width = width;
	canvas.height = height;

	const body = document.body;

	const gl = canvas?.getContext("webgl");
	if (!gl) throw "Your browser needs to be updated to play this game.";

	body.innerHTML = "";
	body.appendChild(canvas);

	canvas.addEventListener("click", startOnClick);

	const vertexShader = SHADER(gl, true)`#version 100
precision highp float;

attribute vec3 position;
attribute vec3 a_normal;
uniform mat4 projection;
uniform vec3 major_position;

varying vec3 v_normal;

void main() {
	gl_Position = projection * vec4(position + major_position, 1);
	v_normal = a_normal;
}`;

	const fragmentShader = SHADER(gl, false)`#version 100
precision mediump float;

varying vec3 v_normal;

vec3 sunlight = vec3(-.3, -.8, 1);
vec3 sandstone = vec3(0.84, 0.76, 0.64);

void main() {
	float brightness = min(1.1, 0.8 + 0.3 * dot(v_normal, sunlight));
	gl_FragColor = vec4(brightness * sandstone, 1);
}`;

	const wallBlocks = makeWallBlocks();
	const maze = makeMaze();

	const wallBlockBuffer =
		gl.createBuffer() || E(1006)`Failed to allocate buffer`;
	onRelease(() => void gl.deleteBuffer(wallBlockBuffer));

	gl.bindBuffer(gl.ARRAY_BUFFER, wallBlockBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, wallBlocks.rawData, gl.STATIC_DRAW);

	const wallProgram = PROGRAM(gl, vertexShader, fragmentShader);
	link(gl, wallProgram);

	const renderInfo: RenderInfo = {
		gl,
		dim: { width, height },
		wallProgram,
		wallBlocks,
		wallBlockBuffer,
		attribute: {
			position: gl.getAttribLocation(wallProgram, "position"),
			normal: gl.getAttribLocation(wallProgram, "a_normal"),
		},
		uniform: {
			majorPosition:
				gl.getUniformLocation(wallProgram, "major_position") ||
				E(1005)`Missing uniform attribute`,
			projection:
				gl.getUniformLocation(wallProgram, "projection") ||
				E(1007)`Missing "projection"`,
		},
	};

	render({ maze, renderInfo });
}

function onKeyboard() {}

function startOnClick(e: MouseEvent) {
	console.log("clicked!");

	const canvas = e.target as HTMLCanvasElement;
	canvas.requestPointerLock();
}

onWindowEvent("mousemove", (e: unknown) => {
	if (!document.pointerLockElement) return;

	const event = e as MouseEvent;

	console.log(event.movementX, event.movementY);
});

onWindowEvent("load", () => {
	try {
		runAndCleanOnError(run);
	} catch (error) {
		document.body.innerText = String(error);
	}
});
