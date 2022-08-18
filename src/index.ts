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
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;

	const body = document.body;

	const gl = canvas?.getContext("webgl");
	if (!gl) throw "Your browser needs to be updated to play this game.";

	body.innerHTML = "";
	body.appendChild(canvas);

	const vertexShader = SHADER(gl, true)`#version 100

precision highp float;

attribute vec2 position;

void main() {
	gl_Position = vec4(position, 0.0, 1.0);
	gl_PointSize = 128.0;
}`;

	const fragmentShader = SHADER(gl, false)`#version 100
precision mediump float;

void main() {
	vec2 fragmentPosition = 2.0 * gl_PointCoord - 1.0;
	float distance = length(fragmentPosition);
	float distanceSqrd = distance * distance;
	gl_FragColor = vec4(0.2/distanceSqrd, 0.1/distanceSqrd, 0.0, 1.0);
}`;

	const program = PROGRAM(gl, vertexShader, fragmentShader);
	link(gl, program);

	gl.enableVertexAttribArray(0);
	const buffer = gl.createBuffer();
	onRelease(() => void gl.deleteBuffer(buffer));

	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0]), gl.STATIC_DRAW);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

	gl.useProgram(program);
	gl.drawArrays(gl.POINTS, 0, 1);
}

onWindowEvent("load", () => {
	try {
		runAndCleanOnError(run);
	} catch (error) {
		document.body.innerText = String(error);
	}
});
