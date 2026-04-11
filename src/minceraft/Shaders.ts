export const blankCubeVSText = `
    precision mediump float;

    uniform vec4 uLightPos;    
    uniform mat4 uView;
    uniform mat4 uProj;
    
    attribute vec4 aNorm;
    attribute vec4 aVertPos;
    attribute vec4 aOffset;
    attribute vec2 aUV;
    
    varying vec4 normal;
    varying vec4 wsPos;
    varying vec2 uv;

    void main () {

        gl_Position = uProj * uView * (aVertPos + aOffset);
        wsPos = aVertPos + aOffset;
        normal = normalize(aNorm);
        uv = aUV;
    }
`;

export const blankCubeFSText = `
    precision mediump float;

    uniform vec4 uLightPos;
    
    varying vec4 normal;
    varying vec4 wsPos;
    varying vec2 uv;
    
    void main() {
        vec3 kd = vec3(1.0, 1.0, 1.0);
        vec3 ka = vec3(0.1, 0.1, 0.1);

        /* Compute light fall off */
        vec4 lightDirection = uLightPos - wsPos;
        float dot_nl = dot(normalize(lightDirection), normalize(normal));
	    dot_nl = clamp(dot_nl, 0.0, 1.0);
	
        gl_FragColor = vec4(clamp(ka + dot_nl * kd, 0.0, 1.0), 1.0);
    }
`;

export const previewCubeVSText = `
    precision mediump float;

    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform vec2 uScreenOffset;

    attribute vec4 aNorm;
    attribute vec4 aVertPos;
    attribute vec2 aUV;

    varying vec3 vNormal;
    varying vec2 vUV;

    void main () {
        vec4 worldPos = uModel * aVertPos;
        gl_Position = uProj * uView * worldPos;
        gl_Position.xy += uScreenOffset * gl_Position.w;
        vNormal = normalize((uModel * vec4(aNorm.xyz, 0.0)).xyz);
        vUV = aUV;
    }
`;

export const previewCubeFSText = `
    precision mediump float;

    uniform sampler2D uTopTexture;
    uniform sampler2D uSideTexture;
    uniform sampler2D uBottomTexture;
    uniform vec3 uLightDir;

    varying vec3 vNormal;
    varying vec2 vUV;

    void main() {
        vec3 normal = normalize(vNormal);
        vec4 texColor;
        vec2 sideUV = vec2(vUV.x, 1.0 - vUV.y);

        if (normal.y > 0.5) {
            texColor = texture2D(uTopTexture, vUV);
        } else if (normal.y < -0.5) {
            texColor = texture2D(uBottomTexture, vUV);
        } else {
            texColor = texture2D(uSideTexture, sideUV);
        }

        float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
        float lighting = 0.25 + diffuse * 0.75;

        gl_FragColor = vec4(texColor.rgb * lighting, texColor.a);
    }
`;
