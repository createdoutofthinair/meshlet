@group(1) @binding(0) var<storage,read_write> flowProbe:array<vec4<f32>>;
@compute @workgroup_size(1) fn probeRiverFlow(){
 let bend=.8;
 flowProbe[0]=vec4<f32>(riverDepthAtBend(-.5,bend),riverDepthAtBend(.5,bend),riverFlowSpeedAtBend(-.5,bend),riverFlowSpeedAtBend(.5,bend));
 flowProbe[1]=vec4<f32>(riverFlowCoordinate(10.0,0.0,1.0),riverFlowCoordinate(11.0,1.0,1.0),riverFlowSpeedAtBend(0.0,0.0),riverFlowSpeedAtBend(.98,0.0));
 flowProbe[2]=vec4<f32>(riverAdvectedSlopes(0.0,0.0,0.0,1.0,1.0),riverAdvectedSlopes(0.0,0.0,1.0,1.0,1.0));
 flowProbe[3]=vec4<f32>(riverAdvectedStreak(0.0,0.0,0.0,1.0),riverAdvectedStreak(0.0,0.0,1.0,1.0),riverAdvectedStreak(0.0,0.0,31.999,1.0),riverAdvectedStreak(0.0,0.0,32.001,1.0));
 flowProbe[4]=vec4<f32>(riverAdvectedSlopes(0.0,0.0,31.999,1.0,1.0),riverAdvectedSlopes(0.0,0.0,32.001,1.0,1.0));
 flowProbe[5]=vec4<f32>(waterFresnel(1.0),waterFresnel(.25),waterFresnel(0.0),riverBubblePattern(vec2<f32>(.37,.71)));
 flowProbe[6]=vec4<f32>(waterTransmittance(0.0,1.0).x,waterTransmittance(2.0,1.0).x,waterTransmittance(8.0,1.0).x,waterTransmittance(8.0,1.0).z);
 flowProbe[7]=vec4<f32>(riverSurfaceWaves(0.0,0.0,0.0,1.0).x,riverSurfaceWaves(0.0,0.0,1.0,1.0).x,riverSurfaceWaves(0.0,0.0,31.999,1.0).x,riverSurfaceWaves(0.0,0.0,32.001,1.0).x);
 let rock=rocks[5];let bow=vec2<f32>(rock.position.x,rock.position.z-rock.position.w*rock.shape.w);
 let near=riverRockWaves(bow,0.0);let far=riverRockWaves(bow+vec2<f32>(1000.0,0.0),0.0);
 flowProbe[8]=vec4<f32>(near.x,near.w,far.x,far.w);
 let wake=rock.position.xz+vec2<f32>(rock.position.w*rock.shape.z*.4,rock.position.w*rock.shape.w*2.0);
 flowProbe[9]=vec4<f32>(riverRockWaves(wake,0.0).x,riverRockWaves(wake,1.0).x,rock.position.w,rock.shape.y);
 let w=riverSurfaceWaves(18.0,72.0,5.0,.8);
 flowProbe[10]=vec4<f32>(w.y,(riverSurfaceWaves(18.02,72.0,5.0,.8).x-riverSurfaceWaves(17.98,72.0,5.0,.8).x)/.04,w.z,(riverSurfaceWaves(18.0,72.02,5.0,.8).x-riverSurfaceWaves(18.0,71.98,5.0,.8).x)/.04);
 let sample=rock.position.xz+vec2<f32>(rock.position.w*rock.shape.z*.4,rock.position.w*rock.shape.w*.35);let rr=riverRockWaves(sample,5.0);
 flowProbe[11]=vec4<f32>(rr.y,(riverRockWaves(sample+vec2<f32>(.02,0.0),5.0).x-riverRockWaves(sample-vec2<f32>(.02,0.0),5.0).x)/.04,rr.z,(riverRockWaves(sample+vec2<f32>(0.0,.02),5.0).x-riverRockWaves(sample-vec2<f32>(0.0,.02),5.0).x)/.04);
}
