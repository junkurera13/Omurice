// Subsurface scattering, cheaply. Egg and rice are translucent: light
// wraps past the terminator and glows through thin edges, tinted by the
// material. We patch three.js's physical direct-light term to add that.
import * as THREE from '../vendor/three.module.min.js';

const LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const SSS = `
	float sssNL = dot( geometryNormal, directLight.direction );
	float sssWrap = saturate( ( sssNL + uSSSWrap ) / ( 1.0 + uSSSWrap ) );
	vec3 sssBleed = max( sssWrap - saturate( sssNL ), 0.0 ) * uSSSColor;
	reflectedLight.directDiffuse += ( irradiance + sssBleed * directLight.color ) * BRDF_Lambert( material.diffuseColor );
	float sssBack = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 ) * uSSSBack;
	reflectedLight.directDiffuse += sssBack * directLight.color * uSSSColor * material.diffuseColor;
`;

export function subsurface(mat, { color = [1, 0.55, 0.12], wrap = 0.55, back = 0.35 } = {}) {
  const u = {
    uSSSColor: { value: new THREE.Color(...color) },
    uSSSWrap: { value: wrap },
    uSSSBack: { value: back },
  };
  mat.userData.sss = u;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.split(LINE).join(SSS);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>',
      'uniform vec3 uSSSColor;\nuniform float uSSSWrap;\nuniform float uSSSBack;\n' + chunk,
    );
  };
  mat.customProgramCacheKey = () => 'sss';
  return mat;
}
