/****************************************************************************
 *
 * @file constants
 *
 ****************************************************************************/

const WALL_THICKNESS = 1 / 4;
const DETAIL = 1; // make this bigger to get more curve

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
	// throw new Error(`Code ${errorCode}`);

	// in dev builds
	return (parts, ...args) => {
		const error = new Error(plainLiteral(parts, args));
		error.name = `E(${errorCode})`;
		throw error;
	};
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

/****************************************************************************
 *
 * @file game geometry
 *
 ****************************************************************************/

type EntityRange = {
	offset: number;
	length: number;
};

function makeWall() {
	const STEP = WALL_THICKNESS / DETAIL;

	let normal: number[] = [0, -1, 0];
	const points: number[] = [];

	let entity: EntityRange = { offset: 0, length: 0 };
	const finishEntity = () => {
		const prior = entity;
		const offset = points.length / 6;
		prior.length = offset - prior.offset;

		entity = { offset: points.length / 6, length: 0 };

		return prior;
	};
	const portionColumn = (fullWall: EntityRange) => {
		return {
			offset: fullWall.offset,
			length: 2 + (fullWall.length - 2) * WALL_THICKNESS,
		};
	};

	const vertex = (x: number, y: number, z: number) => {
		points.push(x, y, z, ...normal);
	};

	// the south wall
	for (let x = 0; x <= 1; x += STEP) {
		vertex(x, 0, 0);
		vertex(x, 0, 1);
	}
	const southFront = finishEntity();
	const columnFront = portionColumn(southFront);

	// the top of the south wall
	// (this does not work with the DETAIL stuff)
	normal = [0, 0, 1];
	for (let x = 0; x <= 1; x += STEP) {
		vertex(x, 0, 1);
		vertex(x, WALL_THICKNESS, 1);
	}
	const southTop = finishEntity();
	const columnTop = portionColumn(southTop);

	// the right of the south wall
	normal = [1, 0, 0];
	vertex(1, 0, 0);
	vertex(1, 0, 1);
	vertex(1, WALL_THICKNESS, 0);
	vertex(1, WALL_THICKNESS, 1);
	const southRight = finishEntity();

	// the right of the west wall
	for (let y = 0; y <= 1; y += STEP) {
		vertex(WALL_THICKNESS, y, 0);
		vertex(WALL_THICKNESS, y, 1);
	}
	const westRight = finishEntity();

	// the left of the west wall
	normal = [-1, 0, 0];
	for (let y = 0; y <= 1; y += STEP) {
		vertex(0, y, 0);
		vertex(0, y, 1);
	}
	const westLeft = finishEntity();
	const columnLeft = portionColumn(westLeft);

	normal = [0, 0, 1];
	for (let y = WALL_THICKNESS; y <= 1; y += STEP) {
		vertex(0, y, 1);
		vertex(WALL_THICKNESS, y, 1);
	}
	const westTop = finishEntity();

	return {
		southFront,
		southTop,
		southRight,
		westRight,
		westLeft,
		westTop,
		columnTop,
		columnFront,
		columnLeft,
		rawData: new Float32Array(points),
	};
}

/****************************************************************************
 *
 * @file exe
 *
 ****************************************************************************/

function onWindowEvent(event: string, handler: () => void) {
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

	const vertexShader = SHADER(gl, true)`#version 100

precision highp float;

attribute vec3 position;
attribute vec3 normal;
uniform mat4 projection;

varying vec3 color;

void main() {
	gl_Position = projection * vec4(position, 1);
	color = (1.0 + normal) / 2.0;
}`;

	const fragmentShader = SHADER(gl, false)`#version 100
precision mediump float;

varying vec3 color;

void main() {
	gl_FragColor = vec4(color, 1); // vec4(0.84, 0.76, 0.64, 1.0);
}`;

	const wall = makeWall();

	const buffer = gl.createBuffer();
	onRelease(() => void gl.deleteBuffer(buffer));

	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, wall.rawData, gl.STATIC_DRAW);

	const program = PROGRAM(gl, vertexShader, fragmentShader);
	link(gl, program);

	gl.useProgram(program);
	gl.enable(gl.DEPTH_TEST);
	// gl.enable(gl.CULL_FACE);

	const positionAttrib = gl.getAttribLocation(program, "position");
	const normalAttrib = gl.getAttribLocation(program, "normal");
	console.log(positionAttrib, normalAttrib);

	gl.enableVertexAttribArray(positionAttrib);
	gl.vertexAttribPointer(positionAttrib, 3, gl.FLOAT, false, 24, 0);

	gl.enableVertexAttribArray(normalAttrib);
	gl.vertexAttribPointer(normalAttrib, 3, gl.FLOAT, false, 24, 12);

	const loc = gl.getUniformLocation(program, "projection");
	// prettier-ignore
	const camera = new Float32Array([
		1, 0, 0, 0,
		-.2, .2, 1, 0,
		0, 1, 0, 0,
		-.5, -.5, 0, 1,
	]);

	gl.uniformMatrix4fv(loc, false, camera);

	const drawSurface = (entity: EntityRange) => {
		gl.drawArrays(gl.TRIANGLE_STRIP, entity.offset, entity.length);
	};

	// drawSurface(wall.westTop);
	// drawSurface(wall.westRight);
	// drawSurface(wall.westLeft);

	// drawSurface(wall.columnTop);
	// drawSurface(wall.columnFront);
	drawSurface(wall.columnLeft);

	drawSurface(wall.southTop);
	drawSurface(wall.southFront);
	drawSurface(wall.southRight);
}

onWindowEvent("load", () => {
	try {
		runAndCleanOnError(run);
	} catch (error) {
		document.body.innerText = String(error);
	}
});
